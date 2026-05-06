import './index.css';
import { marked } from 'marked';
import { renderRegistration } from './components/Registration';
import { getUserStats } from './utils/storage';
import { pushSync } from './utils/sync';
import { isAdmin, setAdmin } from './utils/auth';
import { showAuthModal } from './components/AuthModal';
import { getDayOverride, saveDayOverride, clearDayOverride, isCourseLocked, setCourseLock } from './utils/storage';

// --- State ---
let currentView: 'home' | 'detail' | 'editor' = 'home';
let currentDay: string | null = null;
let activeTab = 'topic';
let dayContent: Record<string, string> = {};
let isSessionUnlocked = sessionStorage.getItem('yuwen_session_unlocked') === 'true';

// --- API ---
const fetchList = async (): Promise<string[]> => {
  const res = await fetch('/api/courseware/list');
  const data = await res.json();
  return data.days;
};

const fetchDayContent = async (day: string): Promise<Record<string, string>> => {
  // 优先加载本地修正版
  const override = getDayOverride(day);
  if (override) return override;

  const stats = getUserStats();
  const res = await fetch(`/api/courseware/get?day=${day}&contact=${stats.contact}`);
  const data = await res.json();
  if (res.status === 403) {
    window.dispatchEvent(new CustomEvent('auth_error', { detail: data }));
    return {};
  }
  return data.content;
};

// --- Custom Renderer ---
const renderMarkdown = (md: string, backContent?: string, sectionPrefix: string = "default") => {
  let answerIdx = 0;
  const dayId = (window as any).currentCourseTitle || "unknown";

  let processedMd = md.replace(/\*\*(答：)\*\*/g, '$1');
  processedMd = processedMd.replace(/(答：)[\s\n]*(_{5,}|\[\s{4,}\])/g, '$1$2');
  processedMd = processedMd.replace(/(?:[\-，,])?\s*(\(\)?\d+[\.、]?|[①-⑳])/g, '\n\n$1');
  processedMd = processedMd.replace(/\*\*(\d+[、.])(.*?)\*\*/g, '$1$2'); 
  processedMd = processedMd.replace(/(\*\*【问】.*?\*\*)(\s*\d+[、.])/g, '$1\n\n$2');
  processedMd = processedMd.replace(/([^\n])([①-⑳])/g, '$1\n\n$2');
  processedMd = processedMd.replace(/-{5,}/g, '\n---\n');
  let rawHtml = marked.parse(processedMd) as string;

  let enhancedHtml = rawHtml.replace(/<blockquote>\s*<p>\[!IMPORTANT\]\s*(.+?)<\/p>\s*([\s\S]+?)<\/blockquote>/g, (match, title, body) => {
    const badgeTitle = title.replace(/\[核心背诵\]/, '<span class="badge-gold">核心背诵</span>');
    return `<div class="important-block fade-in"><div class="important-header"><span class="sparkle">✦</span> ${badgeTitle}</div><div class="important-body">${body}</div></div>`;
  });
  
  enhancedHtml = enhancedHtml.replace(/(<div class="important-block fade-in">[\s\S]+?<div class="important-body">)([\s\S]+?)(<\/div>\s*<\/div>)\s*([\s\S]+?)(?=<div class="important-block"|<h2|$)/g, (match, head, body, tail, extra) => {
    const convertedExtra = extra.replace(/<p>(?:\s*<strong[^>]*>)?(\(\)?\d+[\.、]?|[①-⑳])\s*([\s\S]*?)(?:\s*<\/strong>)?<\/p>/g, '<div class="sub-step"><span class="sub-num">$1</span><span class="sub-content">$2</span></div>');
    return `${head}${body}${convertedExtra}${tail}`;
  });
  
  enhancedHtml = enhancedHtml.replace(/<[p|div][^>]*>(?:\s*<strong[^>]*>)?(答：|_{5,}|\[\s{4,}\])([\s\S]*?)(?:\s*<\/strong>)?\s*<\/[p|div]>/g, (match, p1, p2) => {
    return `<div class="answer-area">${p1}${p2}</div>`;
  });

  enhancedHtml = enhancedHtml.replace(/<p>(?:\s*<strong[^>]*>)?(\(\)?\d+[\.、]?|[①-⑳])\s*([\s\S]*?)(?:\s*<\/strong>)?<\/p>/g, '<div class="sub-step"><span class="sub-num">$1</span><span class="sub-content">$2</span></div>');
  
  enhancedHtml = enhancedHtml.replace(/_{5,}|\[\s{4,}\]/g, () => {
    const id = `ans-${dayId}-${sectionPrefix}-${answerIdx++}`;
    const saved = localStorage.getItem(id) || "";
    return `<span class="editable-answer" id="${id}" contenteditable="true" spellcheck="false" 
            onclick="event.stopPropagation()" 
            oninput="localStorage.setItem('${id}', this.innerText); window.triggerSync()">${saved}</span>`;
  });

  enhancedHtml = enhancedHtml.replace(/<p>(?:<strong>)?(\d+[、.])\s*([\s\S]*?)(?:<\/strong>)?(?=<\/p>)/g, '<div class="analysis-step"><span class="step-num">$1</span><span class="step-content">$2</span></div>');

  let rawSections = enhancedHtml.split(/(?=<div class="important-block"|<h2)/).filter(s => s.trim().length > 0);
  const sections: string[] = [];
  rawSections.forEach((s, idx) => {
    const cardId = `card-${sectionPrefix}-${idx}`;
    const isInteractive = s.includes('answer-area') || s.includes('editable-answer') || /_{5,}|\[\s{4,}\]/.test(s);
    if (isInteractive) {
      const guidancePos = s.indexOf('class="analysis-step"');
      if (guidancePos !== -1) {
        const splitStart = s.lastIndexOf('<', guidancePos);
        const stemPart = s.substring(0, splitStart);
        let restPart = s.substring(splitStart);
        let answerPart = "";
        const aMatches = restPart.match(/<(?:p|div) class="answer-area">[\s\S]*?<\/(?:p|div)>/g);
        if (aMatches) {
          answerPart = aMatches.join("");
          aMatches.forEach(match => { restPart = restPart.replace(match, ""); });
        }
        let stemWithReset = stemPart;
        if (stemPart.includes('</h2>')) {
          stemWithReset = stemPart.replace(/(<h2[^>]*>.*?)(<\/h2>)/, `$1<button class="card-reset-btn" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做</button>$2`);
        } else {
          stemWithReset = `<button class="card-reset-btn" style="margin-bottom:15px;" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做本卡</button>${stemPart}`;
        }
        sections.push(`<div id="${cardId}">${stemWithReset}${answerPart}</div>`);
        sections.push(`<!--GUIDANCE--><div id="${cardId}-guidance">${restPart}</div>`);
      } else {
        let sWithReset = s;
        if (s.includes('</h2>')) {
          sWithReset = s.replace(/(<h2[^>]*>.*?)(<\/h2>)/, `$1<button class="card-reset-btn" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做</button>$2`);
        } else {
          sWithReset = `<button class="card-reset-btn" style="margin-bottom:15px;" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做本卡</button>${s}`;
        }
        sections.push(`<div id="${cardId}">${sWithReset}</div>`);
      }
    } else {
      sections.push(s);
    }
  });

  if (sections.length > 1 && sections[0].length < 150 && !sections[0].includes('<!--GUIDANCE-->')) {
    sections[1] = sections[0] + sections[1];
    sections.shift();
  }

  const cardsHtml = sections.map((content, index) => {
    const isGuidanceCard = content.includes('<!--GUIDANCE-->');
    if (isGuidanceCard && backContent) {
      const backHtml = (marked.parse(backContent) as string).replace(/<h[12].*?>.*?<\/h[12]>/g, '');
      return `<div class="card-item flip-container" data-index="${index}"><div class="card-inner" id="card-inner-${index}"><div class="card-front card-content-inner" onclick="window.toggleFlip(${index})"><div class="card-scroll-area"><h2 style="color:var(--accent-pyro)">解析引导 / GUIDANCE</h2>${content.replace('<!--GUIDANCE-->', '')}</div><div class="flip-hint"><span class="sparkle">✦</span> 点击揭晓最终答案 / REVEAL ANSWER</div></div><div class="card-back card-content-inner" onclick="window.toggleFlip(${index})"><div class="card-scroll-area"><h2 style="color:var(--accent)">参考解析 / ANALYSIS</h2>${backHtml}</div><div class="flip-hint" style="color:var(--text-dim); opacity:0.6;">← 点击返回引导 / CLICK TO BACK</div></div></div></div>`;
    }
    return `<div class="card-item" data-index="${index}"><div class="card-content-inner"><div class="card-scroll-area">${content}</div></div></div>`;
  }).join('');

  const dotsHtml = sections.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}" onclick="window.scrollToCard(${i})"></div>`).join('');
  return `<div class="swiper-wrapper"><div class="swiper-main-area"><button class="nav-btn prev" onclick="window.moveCard(-1)">‹</button><div class="card-swiper" id="card-swiper">${cardsHtml}</div><button class="nav-btn next" onclick="window.moveCard(1)">›</button></div><div class="swiper-dots" id="swiper-dots">${dotsHtml}</div></div>`;
};

// --- Components ---
const Header = () => `
  <div class="app-header fade-in">
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="letter-spacing: 1px; font-size: 24px; font-weight: 800; background: linear-gradient(to right, #fff, var(--text-dim)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">语文每日练 · 初中篇 v2.8.1</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <button onclick="window.toggleAdmin()" class="btn-teyvat-small ${isAdmin() ? 'active' : ''}">
          ${isAdmin() ? '已解锁权限' : '权限锁定'}
        </button>
      </div>
    </div>
  </div>
`;

const HomeView = async () => {
  const days = await fetchList();
  const stats = getUserStats();
  const listHtml = days.map(day => {
    const isOverridden = !!getDayOverride(day);
    const isLocked = isCourseLocked(day);
    return `
      <div class="course-card fade-in ${isLocked ? 'locked' : ''}" onclick="window.navigateToDetail('${day}')">
        <div class="poem-info">
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="font-family: var(--font-serif); margin-bottom: 6px;">专项考点第 ${day} 课</h3>
            ${isOverridden ? '<span style="font-size: 10px; color: var(--accent-pyro); font-weight: bold; border: 1px solid var(--accent-pyro); padding: 0 4px; border-radius: 2px;">修正</span>' : ''}
          </div>
          <div class="poem-meta" style="font-size: 13px; color: var(--text-dim);">Day ${day.padStart(2, '0')} · 中考复习专项</div>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
          ${isAdmin() ? `
            <div class="lock-btn" onclick="event.stopPropagation(); window.toggleCourseLock('${day}')" title="切换开启/关闭状态">
              ${isLocked ? '🔒' : '🔓'}
            </div>
            <div class="btn-edit-course" onclick="event.stopPropagation(); window.navigateToEditor('${day}')">✏️</div>
          ` : ''}
          <div style="color: var(--accent-pyro); font-size: 24px;">✦</div>
        </div>
      </div>
    `;
  }).join('');

  let adminPanel = '';
  if (isAdmin()) {
    adminPanel = `
      <div class="tiyvat-admin-panel fade-in">
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="btn-teyvat-op" onclick="window.adminExport()">📥 备份</button>
          <button class="btn-teyvat-op" onclick="document.getElementById('import-file').click()">📤 恢复</button>
          <button class="btn-teyvat-op" onclick="window.adminExportProgress()">📊 背诵记录导出</button>
          <button class="btn-teyvat-op" style="color: #ff4d4d; border-color: #ff4d4d;" onclick="window.adminLock()">锁定存档</button>
          <input type="file" id="import-file" style="display: none;" onchange="window.adminImport(event)">
        </div>
      </div>
    `;
  }

  return `
    <div class="fade-in">
      <div style="margin-bottom: 40px;">
        <h2 style="font-size: 32px; margin-bottom: 12px; font-family: var(--font-serif);">成就卓越语文素养</h2>
        <p style="color: var(--text-dim); font-size: 15px;">旅者：${stats.nickname} · 今日建议学习进度：${days.length > 0 ? 'Day ' + days[0] : '无'}</p>
      </div>
      ${adminPanel}
      <div style="margin-bottom: 25px; font-size: 13px; color: var(--accent-pyro); letter-spacing: 2px; font-weight: bold; border-bottom: 1px solid var(--accent-soft); padding-bottom: 8px;">全部课程列表 / COURSE CATALOG</div>
      <div class="course-list">${listHtml}</div>
    </div>
  `;
};

const DetailView = async (day: string) => {
  (window as any).currentCourseTitle = day;
  (window as any).clearCardAnswers = (cardId: string) => {
    if (!confirm("确定要重做本题吗？")) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelectorAll('.editable-answer').forEach(el => {
      localStorage.removeItem(el.id);
      (el as HTMLElement).innerText = "";
    });
    window.triggerSync();
  };

  if (Object.keys(dayContent).length === 0) dayContent = await fetchDayContent(day);
  const tabs = [{id:'topic',label:'主题'},{id:'methods',label:'方法'},{id:'examples',label:'典例'},{id:'practice',label:'实战'},{id:'review',label:'复习'}];
  let content = dayContent[activeTab] || '# 内容暂缺';
  const reviewRaw = dayContent['review'] || '';
  const reviewSections = reviewRaw.split(/(?=##)/).filter(s => s.startsWith('##'));
  const answerSection = reviewSections.find(s => s.includes('答案')) || '';
  const consolidationSection = reviewSections.find(s => s.includes('巩固') || s.includes('复习') || s.includes('默写')) || '';
  let backContent: string | undefined = undefined;
  if (activeTab === 'practice') backContent = answerSection.replace(/^##.*答案.*\n?/m, '').trim();
  if (activeTab === 'review') {
    content = consolidationSection.replace(/^#+\s*.*巩固复习.*\n?/m, '').trim();
    if (!content) content = '# 暂无复习默写内容';
  }

  return `
    <div style="flex: 1; display: flex; flex-direction: column;" class="fade-in">
      <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px;">
        <div onclick="window.navigateToHome()" style="cursor: pointer; color: var(--accent-pyro); font-weight: bold; border: 1px solid var(--accent-pyro); padding: 4px 12px; border-radius: 2px; font-size: 14px;">← 返回</div>
        <h2 style="font-size: 22px; font-family: var(--font-serif); color: #fff;">第 ${day} 课：专题学习</h2>
      </div>
      <div class="category-tabs">${tabs.map(t => `<div class="tab ${t.id === activeTab ? 'active' : ''}" onclick="window.switchTab('${t.id}')">${t.label}</div>`).join('')}</div>
      <div id="tab-content" style="padding: 0; background: transparent; box-shadow: none; border: none;">${renderMarkdown(content, backContent, activeTab)}</div>
    </div>
  `;
};

const EditorView = async (day: string) => {
  if (Object.keys(dayContent).length === 0) dayContent = await fetchDayContent(day);
  const tabs = [{id:'topic',label:'主题'},{id:'methods',label:'方法'},{id:'examples',label:'典例'},{id:'practice',label:'实战'},{id:'review',label:'复习'}];
  
  const tabEditors = tabs.map(t => `
    <div class="editor-section" id="editor-section-${t.id}" style="${t.id === activeTab ? '' : 'display:none;'}">
      <label style="color: var(--accent-pyro); font-size: 12px; font-weight: bold; margin-bottom: 8px; display: block;">${t.label} 内容 (Markdown)</label>
      <textarea class="tiyvat-textarea" data-tab="${t.id}" oninput="window.updateLocalContent('${t.id}', this.value)">${dayContent[t.id] || ''}</textarea>
    </div>
  `).join('');

  return `
    <div style="flex: 1; display: flex; flex-direction: column;" class="fade-in">
       <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px;">
        <div style="display: flex; align-items: center; gap: 20px;">
          <div onclick="window.navigateToHome()" style="cursor: pointer; color: var(--accent-pyro); font-weight: bold; border: 1px solid var(--accent-pyro); padding: 4px 12px; border-radius: 2px; font-size: 14px;">← 取消</div>
          <h2 style="font-size: 22px; font-family: var(--font-serif); color: #fff;">精修：第 ${day} 课</h2>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-teyvat-small" style="background: var(--error); border-color: var(--error); color: white;" onclick="window.clearOverride('${day}')">恢复默认</button>
          <button class="btn-teyvat-small active" onclick="window.saveOverride('${day}')">💾 保存修改</button>
        </div>
      </div>
      <div class="category-tabs">${tabs.map(t => `<div class="tab ${t.id === activeTab ? 'active' : ''}" onclick="window.switchEditorTab('${t.id}')">${t.label}</div>`).join('')}</div>
      <div id="editor-container" style="flex: 1; display: flex; flex-direction: column;">
        ${tabEditors}
      </div>
    </div>
  `;
};

// --- App Control ---
const initSwiperObserver = () => {
  const swiper = document.getElementById('card-swiper');
  const dots = document.querySelectorAll('.dot');
  if (!swiper || dots.length === 0) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const index = (entry.target as HTMLElement).dataset.index;
        dots.forEach(dot => dot.classList.remove('active'));
        const activeDot = document.querySelector(`.dot[data-index="${index}"]`);
        if (activeDot) activeDot.classList.add('active');
        const prevBtn = document.querySelector('.nav-btn.prev') as HTMLButtonElement;
        const nextBtn = document.querySelector('.nav-btn.next') as HTMLButtonElement;
        if (prevBtn) prevBtn.style.opacity = index === '0' ? '0.2' : '1';
        if (nextBtn) nextBtn.style.opacity = parseInt(index || '0') === dots.length - 1 ? '0.2' : '1';
      }
    });
  }, { root: swiper, threshold: 0.6 });
  document.querySelectorAll('.card-item').forEach(card => observer.observe(card));
};

const render = async () => {
  const root = document.getElementById('app');
  if (!root) return;
  const stats = getUserStats();
  if (!stats.nickname || !stats.contact || !isSessionUnlocked) {
    root.innerHTML = '';
    renderRegistration(() => {
      sessionStorage.setItem('yuwen_session_unlocked', 'true');
      window.location.reload();
    });
    return;
  }
  root.innerHTML = Header();
  if (currentView === 'home') root.innerHTML += await HomeView();
  else if (currentView === 'detail' && currentDay) {
    root.innerHTML += await DetailView(currentDay);
    setTimeout(initSwiperObserver, 100);
  } else if (currentView === 'editor' && currentDay) {
    root.innerHTML += await EditorView(currentDay);
  }
};

// --- Global Methods ---
let syncTimeout: any = null;
(window as any).triggerSync = () => {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => { pushSync(); }, 2000);
};

(window as any).scrollToCard = (index: number) => {
  const swiper = document.getElementById('card-swiper');
  if (swiper) {
    const card = swiper.querySelector(`.card-item[data-index="${index}"]`);
    if (card) swiper.scrollTo({ left: (card as HTMLElement).offsetLeft, behavior: 'smooth' });
  }
};
(window as any).moveCard = (dir: number) => {
  const activeDot = document.querySelector('.dot.active') as HTMLElement;
  if (activeDot) {
    const currentIndex = parseInt(activeDot.dataset.index || '0');
    (window as any).scrollToCard(currentIndex + dir);
  }
};
(window as any).toggleFlip = (index: number) => {
  const inner = document.getElementById(`card-inner-${index}`);
  if (inner) inner.classList.toggle('flipped');
};
(window as any).navigateToDetail = (day: string) => {
  if (isCourseLocked(day) && !isAdmin()) {
    alert('该课程当前处于关闭状态，请联系老师开启。');
    return;
  }
  currentView = 'detail'; currentDay = day; activeTab = 'topic'; dayContent = {}; render();
};
(window as any).toggleCourseLock = (day: string) => {
  const current = isCourseLocked(day);
  setCourseLock(day, !current);
  render();
};
(window as any).navigateToHome = () => {
  currentView = 'home'; currentDay = null; dayContent = {}; render();
};
(window as any).switchTab = (tab: string) => {
  activeTab = tab; render().then(() => {
    const swiper = document.getElementById('card-swiper');
    if (swiper) swiper.scrollLeft = 0;
  });
};

// --- Admin Methods ---
(window as any).toggleAdmin = () => {
  if (isAdmin()) { setAdmin(false); window.location.reload(); }
  else { showAuthModal(() => window.location.reload()); }
};

(window as any).navigateToEditor = (day: string) => {
  currentView = 'editor'; currentDay = day; activeTab = 'topic'; dayContent = {}; render();
};

(window as any).switchEditorTab = (tab: string) => {
  activeTab = tab;
  document.querySelectorAll('.editor-section').forEach(s => (s as HTMLElement).style.display = 'none');
  const target = document.getElementById(`editor-section-${tab}`);
  if (target) target.style.display = 'block';
  document.querySelectorAll('.category-tabs .tab').forEach(t => t.classList.remove('active'));
  const activeTabEl = document.querySelector(`.category-tabs .tab[onclick="window.switchEditorTab('${tab}')"]`);
  if (activeTabEl) activeTabEl.classList.add('active');
};

(window as any).updateLocalContent = (tab: string, val: string) => {
  dayContent[tab] = val;
};

(window as any).saveOverride = (day: string) => {
  saveDayOverride(day, dayContent);
  alert('内容修正已保存！');
  (window as any).navigateToHome();
};

(window as any).clearOverride = (day: string) => {
  if (confirm('确定要清除所有修正并恢复服务器默认版本吗？')) {
    clearDayOverride(day);
    window.location.reload();
  }
};

(window as any).adminLock = () => {
  setAdmin(false);
  window.location.reload();
};

(window as any).adminExport = () => {
  const data: any = { stats: getUserStats(), progress: {}, overrides: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('yuwen_progress_')) data.progress[key] = localStorage.getItem(key);
    if (key?.startsWith('day_override_')) data.overrides[key] = localStorage.getItem(key);
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `yuwen_backup_${new Date().toISOString().split('T')[0]}.json`; a.click();
  URL.revokeObjectURL(url);
};

(window as any).adminImport = (e: any) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);
      if (data.stats) localStorage.setItem('yuwen_user_stats', JSON.stringify(data.stats));
      for (const k in data.progress) localStorage.setItem(k, data.progress[k]);
      for (const k in data.overrides) localStorage.setItem(k, data.overrides[k]);
      alert('存档恢复成功！');
      window.location.reload();
    } catch { alert('导入失败，文件格式错误'); }
  };
  reader.readAsText(file);
};

(window as any).adminExportProgress = async () => {
  try {
    const res = await fetch('/api/admin/export-progress?key=2721&format=json');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'all_progress.json'; a.click();
    URL.revokeObjectURL(url);
  } catch { alert('导出失败，请检查管理暗号设置'); }
};

window.addEventListener('auth_error', (e: any) => {
  alert(e.detail.message || '权限错误');
  localStorage.clear();
  window.location.reload();
});

render();
