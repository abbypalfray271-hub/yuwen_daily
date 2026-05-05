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
const renderMarkdown = (md: string) => {
  let processedMd = md.replace(/([^\n])([①-⑳])/g, '$1\n\n$2');
  processedMd = processedMd.replace(/-{5,}/g, '\n---\n');
  let rawHtml = marked.parse(processedMd) as string;

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

  return `<div class="reading-container">${enhancedHtml}</div>`;
};

// --- Components ---
const Header = () => `
  <div class="app-header fade-in">
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="text-transform: uppercase; letter-spacing: 2px;">Chinese Daily Practice</h1>
        <p style="font-size: 14px; color: var(--text-dim);">语文每日练 · 初中篇 v2.1.0</p>
      </div>
      <div style="font-size: 10px; color: var(--accent-pyro); border: 1px solid rgba(255, 95, 46, 0.3); padding: 2px 8px; border-radius: 2px;">TEYVAT EDITION</div>
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
    <div style="flex: 1;" class="fade-in">
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
  if (Object.keys(dayContent).length === 0) dayContent = await fetchDayContent(day);
  const tabs = [{id:'topic',label:'主题'},{id:'methods',label:'方法'},{id:'examples',label:'典例'},{id:'practice',label:'实战'},{id:'review',label:'复习'}];
  
  return `
    <div style="flex: 1; display: flex; flex-direction: column;" class="fade-in">
      <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px;">
        <div onclick="window.navigateToHome()" style="cursor: pointer; color: var(--accent-pyro); font-weight: bold; border: 1px solid var(--accent-pyro); padding: 4px 12px; border-radius: 2px; font-size: 14px;">← 返回</div>
        <h2 style="font-size: 22px; font-family: var(--font-serif); color: #fff;">第 ${day} 课：专题学习</h2>
      </div>
      <div class="category-tabs">
        ${tabs.map(t => `<div class="tab ${t.id === activeTab ? 'active' : ''}" onclick="window.switchTab('${t.id}')">${t.label}</div>`).join('')}
      </div>
      <div id="tab-content">
        ${renderMarkdown(dayContent[activeTab] || '# 内容暂缺')}
      </div>
    </div>
  `;
};

// --- App Control ---
const render = async () => {
  const root = document.getElementById('app');
  if (!root) return;
  
  if (currentView === 'induction') {
    root.innerHTML = InductionView();
  } else {
    root.innerHTML = Header();
    if (currentView === 'home') root.innerHTML += await HomeView();
    else if (currentDay) root.innerHTML += await DetailView(currentDay);
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
  activeTab = tab; render();
};

render();
