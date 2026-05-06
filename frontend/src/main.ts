import './index.css';
import { marked } from 'marked';

// --- Types ---
interface CoursewareContent {
  success: boolean;
  day: string;
  content: Record<string, string>;
}

// --- State ---
let currentView: 'induction' | 'home' | 'detail' = localStorage.getItem('activeCode') ? 'home' : 'induction';
let currentDay: string | null = null;
let activeTab = 'topic';
let dayContent: Record<string, string> = {};

// --- API ---
const fetchList = async (): Promise<string[]> => {
  const res = await fetch('/api/courseware/list');
  const data = await res.json();
  return data.days;
};

const fetchDayContent = async (day: string): Promise<Record<string, string>> => {
  const code = localStorage.getItem('activeCode');
  const res = await fetch(`/api/courseware/get?day=${day}&code=${code}`);
  const data: CoursewareContent = await res.json();
  return data.content;
};

// --- Custom Renderer ---
const renderMarkdown = (md: string, backContent?: string, sectionPrefix: string = "default") => {
  let answerIdx = 0;
  const courseTitle = (window as any).currentCourseTitle || "unknown";

  // 极致预处理：强制移除“答：”周围的加粗，并将其与后续下划线强制拉到同一行
  let processedMd = md.replace(/\*\*(答：)\*\*/g, '$1');
  processedMd = processedMd.replace(/(答：)[\s\n]*(_{5,}|\[\s{4,}\])/g, '$1$2');
  
  // 预处理：万能编号强制换行，识别 (1), ()1, ① 等所有格式，并自动清理前面的连接符
  processedMd = processedMd.replace(/(?:[\-，,])?\s*(\(\)?\d+[\.、]?|[①-⑳])/g, '\n\n$1');
  
  // 预处理：去掉编号周围的加粗并强制换行
  processedMd = processedMd.replace(/\*\*(\d+[、.])(.*?)\*\*/g, '$1$2'); 
  processedMd = processedMd.replace(/(\*\*【问】.*?\*\*)(\s*\d+[、.])/g, '$1\n\n$2');
  processedMd = processedMd.replace(/([^\n])([①-⑳])/g, '$1\n\n$2');
  processedMd = processedMd.replace(/-{5,}/g, '\n---\n');
  let rawHtml = marked.parse(processedMd) as string;

  // 1. 语义化增强：识别核心背诵块
  let enhancedHtml = rawHtml.replace(/<blockquote>\s*<p>\[!IMPORTANT\]\s*(.+?)<\/p>\s*([\s\S]+?)<\/blockquote>/g, (match, title, body) => {
    const badgeTitle = title.replace(/\[核心背诵\]/, '<span class="badge-gold">核心背诵</span>');
    return `
      <div class="important-block fade-in">
        <div class="important-header">
          <span class="sparkle">✦</span> ${badgeTitle}
        </div>
        <div class="important-body">${body}</div>
      </div>
    `;
  });
  
  // 核心增强补丁：强制吞噬后续所有内容直到新标题，实现真正的“知识归位”
  enhancedHtml = enhancedHtml.replace(/(<div class="important-block fade-in">[\s\S]+?<div class="important-body">)([\s\S]+?)(<\/div>\s*<\/div>)\s*([\s\S]+?)(?=<div class="important-block"|<h2|$)/g, (match, head, body, tail, extra) => {
    // 对吸入的内容同样执行子步骤对齐转换
    const convertedExtra = extra.replace(/<p>(?:\s*<strong[^>]*>)?(\(\)?\d+[\.、]?|[①-⑳])\s*([\s\S]*?)(?:\s*<\/strong>)?<\/p>/g, 
      '<div class="sub-step"><span class="sub-num">$1</span><span class="sub-content">$2</span></div>');
    return `${head}${body}${convertedExtra}${tail}`;
  });
  
  // 2. 核心增强：精准且鲁棒地识别答题区 (不限标签，支持嵌套)
  enhancedHtml = enhancedHtml.replace(/<[p|div][^>]*>(?:\s*<strong[^>]*>)?(答：|_{5,}|\[\s{4,}\])([\s\S]*?)(?:\s*<\/strong>)?\s*<\/[p|div]>/g, (match, p1, p2) => {
    return `<div class="answer-area">${p1}${p2}</div>`;
  });

  // 2.5 子步骤增强：识别 (1), ()1, ① 等所有编号格式并实现竖排对齐
  enhancedHtml = enhancedHtml.replace(/<p>(?:\s*<strong[^>]*>)?(\(\)?\d+[\.、]?|[①-⑳])\s*([\s\S]*?)(?:\s*<\/strong>)?<\/p>/g, 
    '<div class="sub-step"><span class="sub-num">$1</span><span class="sub-content">$2</span></div>');
  
  // 3. 交互增强：强制将所有长下划线和方括号占位符转换为可输入区域
  enhancedHtml = enhancedHtml.replace(/_{5,}|\[\s{4,}\]/g, () => {
    const id = `ans-${courseTitle}-${sectionPrefix}-${answerIdx++}`;
    const saved = localStorage.getItem(id) || "";
    return `<span class="editable-answer" id="${id}" contenteditable="true" spellcheck="false" 
            onclick="event.stopPropagation()" 
            oninput="localStorage.setItem('${id}', this.innerText)">${saved}</span>`;
  });

  // 语义化增强：将“1、”，“2、”等引导步骤标记为列表式分析步骤 (支持跨行)
  enhancedHtml = enhancedHtml.replace(/<p>(?:<strong>)?(\d+[、.])\s*([\s\S]*?)(?:<\/strong>)?(?=<\/p>)/g, '<div class="analysis-step"><span class="step-num">$1</span><span class="step-content">$2</span></div>');

  // 将内容拆分为多个卡片
  let rawSections = enhancedHtml.split(/(?=<div class="important-block"|<h2)/).filter(s => s.trim().length > 0);
  
  // 核心优化：将内容拆分为多个卡片，并为所有交互式卡片注入“重做”按钮
  const sections: string[] = [];
  rawSections.forEach((s, idx) => {
    const cardId = `card-${sectionPrefix}-${idx}`; // 为每个卡片生成唯一 ID
    
    // 识别交互式卡片：包含答题区、长下划线、方括号或已转换的填空区
    const isInteractive = s.includes('answer-area') || s.includes('editable-answer') || /_{5,}|\[\s{4,}\]/.test(s);
    
    if (isInteractive) {
      // 物理定位法：寻找解析引导的起点
      const guidancePos = s.indexOf('class="analysis-step"');
      
      if (guidancePos !== -1) {
        const splitStart = s.lastIndexOf('<', guidancePos);
        const stemPart = s.substring(0, splitStart);
        let restPart = s.substring(splitStart);
        
        // 精准打捞所有答题区段落（兼容 p 和 div）
        let answerPart = "";
        const aMatches = restPart.match(/<(?:p|div) class="answer-area">[\s\S]*?<\/(?:p|div)>/g);
        if (aMatches) {
          answerPart = aMatches.join("");
          aMatches.forEach(match => { restPart = restPart.replace(match, ""); });
        }
        
        // 注入按钮：优先插入 H2 标题后，否则插入段落开头
        let stemWithReset = stemPart;
        if (stemPart.includes('</h2>')) {
          stemWithReset = stemPart.replace(/(<h2[^>]*>.*?)(<\/h2>)/, `$1<button class="card-reset-btn" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做</button>$2`);
        } else {
          stemWithReset = `<button class="card-reset-btn" style="margin-bottom:15px;" onclick="event.stopPropagation(); clearCardAnswers('${cardId}')">🔄 重做本卡</button>${stemPart}`;
        }
        
        sections.push(`<div id="${cardId}">${stemWithReset}${answerPart}</div>`);
        sections.push(`<!--GUIDANCE--><div id="${cardId}-guidance">${restPart}</div>`);
      } else {
        // 无引导的纯交互卡片
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

  // 优化：如果第一张卡片过短，则将其与下一张合并
  if (sections.length > 1 && sections[0].length < 150 && !sections[0].includes('<!--GUIDANCE-->')) {
    sections[1] = sections[0] + sections[1];
    sections.shift();
  }

  const cardsHtml = sections.map((content, index) => {
    const isGuidanceCard = content.includes('<!--GUIDANCE-->');
    
    if (isGuidanceCard && backContent) {
      const backHtml = (marked.parse(backContent) as string).replace(/<h[12].*?>.*?<\/h[12]>/g, '');
      return `
        <div class="card-item flip-container" data-index="${index}">
          <div class="card-inner" id="card-inner-${index}">
            <div class="card-front card-content-inner" onclick="window.toggleFlip(${index})">
              <div class="card-scroll-area">
                <h2 style="color:var(--accent-pyro)">解析引导 / GUIDANCE</h2>
                ${content.replace('<!--GUIDANCE-->', '')}
              </div>
              <div class="flip-hint">
                <span class="sparkle">✦</span> 点击揭晓最终答案 / REVEAL ANSWER
              </div>
            </div>
            <div class="card-back card-content-inner" onclick="window.toggleFlip(${index})">
              <div class="card-scroll-area">
                <h2 style="color:var(--accent)">参考解析 / ANALYSIS</h2>
                ${backHtml}
              </div>
              <div class="flip-hint" style="color:var(--text-dim); opacity:0.6;">
                ← 点击返回引导 / CLICK TO BACK
              </div>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="card-item" data-index="${index}">
        <div class="card-content-inner">
          <div class="card-scroll-area">${content}</div>
        </div>
      </div>
    `;
  }).join('');

  const dotsHtml = sections.map((_, i) => `
    <div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}" onclick="window.scrollToCard(${i})"></div>
  `).join('');

  return `
    <div class="swiper-wrapper">
      <div class="swiper-main-area">
        <button class="nav-btn prev" onclick="window.moveCard(-1)">‹</button>
        <div class="card-swiper" id="card-swiper">${cardsHtml}</div>
        <button class="nav-btn next" onclick="window.moveCard(1)">›</button>
      </div>
      <div class="swiper-dots" id="swiper-dots">${dotsHtml}</div>
    </div>
  `;
};

// --- Components ---
const Header = () => `
  <div class="app-header fade-in">
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="letter-spacing: 1px; font-size: 26px; font-weight: 800; background: linear-gradient(to right, #fff, var(--text-dim)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">语文每日练 · 初中篇 v2.6.0</h1>
      </div>
    </div>
  </div>
`;

const InductionView = () => `
  <div class="tiyvat-auth-overlay fade-in">
    <div class="tiyvat-card">
      <div style="text-align: center; margin-bottom: 40px;">
        <h2 style="color: var(--accent-pyro); margin-bottom: 12px; font-size: 26px; font-family: var(--font-serif);">缔结契约</h2>
        <p style="font-size: 14px; color: var(--text-dim); letter-spacing: 1px;">Establish a Contract with Wisdom</p>
      </div>
      
      <div style="margin-bottom: 30px;">
        <label style="display: block; font-size: 13px; color: var(--accent-pyro); margin-bottom: 12px; font-weight: 600;">通行凭证 / ACTIVATION CODE</label>
        <input type="text" id="activateInput" class="tiyvat-input" placeholder="输入通行凭证..." autocomplete="off">
      </div>
      
      <button class="btn-teyvat" onclick="window.handleActivate()" style="width: 100%; height: 50px; font-size: 16px;">确认开启 / CONFIRM</button>
      
      <div style="margin-top: 35px; text-align: center; font-size: 13px; color: var(--text-dim); opacity: 0.8; font-style: italic;">
        若无凭证，请咨询您的授课导师
      </div>
    </div>
  </div>
`;

const HomeView = async () => {
  const days = await fetchList();
  const listHtml = days.map(day => `
    <div class="course-card fade-in" onclick="window.navigateToDetail('${day}')">
      <div class="poem-info">
        <h3 style="font-family: var(--font-serif); margin-bottom: 6px;">专项考点第 ${day} 课</h3>
        <div class="poem-meta" style="font-size: 13px; color: var(--text-dim);">Day ${day.padStart(2, '0')} · 中考复习专项</div>
      </div>
      <div style="color: var(--accent-pyro); font-size: 24px;">✦</div>
    </div>
  `).join('');

  return `
    <div class="fade-in">
      <div style="margin-bottom: 40px;">
        <h2 style="font-size: 32px; margin-bottom: 12px; font-family: var(--font-serif);">成就卓越语文素养</h2>
        <p style="color: var(--text-dim); font-size: 15px;">已成功通过契约验证。今日建议学习进度：${days.length > 0 ? 'Day ' + days[0] : '无'}</p>
      </div>
      <div style="margin-bottom: 25px; font-size: 13px; color: var(--accent-pyro); letter-spacing: 2px; font-weight: bold; border-bottom: 1px solid var(--accent-soft); padding-bottom: 8px;">全部课程列表 / COURSE CATALOG</div>
      <div class="course-list">${listHtml}</div>
    </div>
  `;
};

const DetailView = async (day: string) => {
  (window as any).currentCourseTitle = day;

  // 注入定向清空卡片答案逻辑
  (window as any).clearCardAnswers = (cardId: string) => {
    if (!confirm("确定要重做本题吗？")) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelectorAll('.editable-answer').forEach(el => {
      localStorage.removeItem(el.id);
      (el as HTMLElement).innerText = "";
    });
  };

  if (Object.keys(dayContent).length === 0) dayContent = await fetchDayContent(day);
  const tabs = [{id:'topic',label:'主题'},{id:'methods',label:'方法'},{id:'examples',label:'典例'},{id:'practice',label:'实战'},{id:'review',label:'复习'}];
  
  let content = dayContent[activeTab] || '# 内容暂缺';
  
  // 智能内容切分逻辑
  const reviewRaw = dayContent['review'] || '';
  const reviewSections = reviewRaw.split(/(?=##)/).filter(s => s.startsWith('##'));
  const answerSection = reviewSections.find(s => s.includes('答案')) || '';
  const consolidationSection = reviewSections.find(s => s.includes('巩固') || s.includes('复习') || s.includes('默写')) || '';

  let backContent: string | undefined = undefined;

  if (activeTab === 'practice') {
    backContent = answerSection.replace(/^##.*答案.*\n?/m, '').trim();
  }

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
      <div class="category-tabs">
        ${tabs.map(t => `<div class="tab ${t.id === activeTab ? 'active' : ''}" onclick="window.switchTab('${t.id}')">${t.label}</div>`).join('')}
      </div>
      <div id="tab-content" style="padding: 0; background: transparent; box-shadow: none; border: none;">
        ${renderMarkdown(content, backContent, activeTab)}
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
  }, {
    root: swiper,
    threshold: 0.6
  });

  document.querySelectorAll('.card-item').forEach(card => observer.observe(card));
};

const render = async () => {
  const root = document.getElementById('app');
  if (!root) return;
  
  if (currentView === 'induction') {
    root.innerHTML = InductionView();
  } else {
    root.innerHTML = Header();
    if (currentView === 'home') root.innerHTML += await HomeView();
    else if (currentDay) {
      root.innerHTML += await DetailView(currentDay);
      setTimeout(initSwiperObserver, 100);
    }
  }
};

// --- Global Methods ---
(window as any).scrollToCard = (index: number) => {
  const swiper = document.getElementById('card-swiper');
  if (swiper) {
    const card = swiper.querySelector(`.card-item[data-index="${index}"]`);
    if (card) {
      swiper.scrollTo({
        left: (card as HTMLElement).offsetLeft,
        behavior: 'smooth'
      });
    }
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
  if (inner) {
    inner.classList.toggle('flipped');
  }
};


// --- Global Methods ---
(window as any).handleActivate = () => {
  const input = document.getElementById('activateInput') as HTMLInputElement;
  if (input.value === '6688' || input.value === '8888') {
    localStorage.setItem('activeCode', input.value);
    currentView = 'home';
    render();
  } else { alert('凭证校验失败，请重新确认。'); }
};

(window as any).navigateToDetail = (day: string) => {
  currentView = 'detail'; currentDay = day; activeTab = 'topic'; dayContent = {}; render();
};

(window as any).navigateToHome = () => {
  currentView = 'home'; currentDay = null; dayContent = {}; render();
};

(window as any).switchTab = (tab: string) => {
  activeTab = tab; 
  render().then(() => {
    // 切换 Tab 时，滑块复位
    const swiper = document.getElementById('card-swiper');
    if (swiper) swiper.scrollLeft = 0;
  });
};

render();

