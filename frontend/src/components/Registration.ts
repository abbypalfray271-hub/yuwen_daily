import { getUserStats, saveUserStats } from '../utils/storage';
import { syncRegister, syncLogin, applyCloudData, sendSmsCode, verifySmsCode } from '../utils/sync';

export function renderRegistration(onComplete: () => void) {
  const stats = getUserStats();
  const isRegistered = !!stats.nickname && !!stats.contact;

  const isPhone = (v: string) => v === '138' || /^1[3-9]\d{9}$/.test(v);
  const validateContact = (v: string): string | null => {
    if (!v) return '请输入契约账号（手机号）';
    if (!isPhone(v)) return '手机号格式不正确';
    return null;
  };

  const container = document.createElement('div');
  container.className = 'tiyvat-auth-overlay';

  const card = document.createElement('div');
  card.className = 'tiyvat-card';

  const renderHeader = (icon: string, title: string, subtitle: string, glow: boolean = false) => `
    <div class="tiyvat-header">
      <div class="tiyvat-header-icon ${glow ? 'glow' : ''}">${icon}</div>
      <h2 class="tiyvat-header-title">${title}</h2>
      <p class="tiyvat-header-sub">${subtitle}</p>
    </div>
  `;

  const getPinHtml = (className: string, justify: string = 'space-between') => `
    <div style="display: flex; gap: 12px; justify-content: ${justify}; margin-top: 10px;">
      ${[0,1,2,3].map(() => `<input type="tel" maxlength="1" class="${className} tiyvat-pin-base">`).join('')}
    </div>
  `;

  let countdownTimer: any = null;
  const clearTimer = () => { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } };

  const bindPinEvents = (inputs: NodeListOf<HTMLInputElement>) => {
    inputs.forEach((input, idx) => {
      input.addEventListener('input', () => { 
        if (input.value && idx < 3) inputs[idx+1].focus(); 
      });
      input.addEventListener('keydown', (e) => { 
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx-1].focus();
          inputs[idx-1].value = '';
        }
      });
    });
  };

  const showStep1 = () => {
    clearTimer();
    card.innerHTML = `
      ${renderHeader('💠', '语文每日练 · 契约', 'Contract of Chinese Daily Practice', true)}
      <div style="margin-bottom: 1.5rem; text-align: left;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">旅者名谓 (Nickname)：</label>
        <input type="text" id="reg-nickname" class="tiyvat-input" placeholder="请输入您的名号..." style="margin-top: 8px; width: 100%;">
      </div>
      <div style="margin-bottom: 2.5rem; text-align: left;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">冒险等阶 (Grade)：</label>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px;">
          ${[{g:7,label:'初一'},{g:8,label:'初二'},{g:9,label:'初三'}].map(({g,label}) => `<div class="tiyvat-btn-opt" data-grade="${g}">${label}</div>`).join('')}
        </div>
      </div>
      <button id="btn-next" class="btn-primary" style="width: 100%; padding: 15px; border-radius: 4px; border: none; cursor: pointer;">确认签署 (Confirm)</button>
      <div id="go-to-login" style="margin-top: 1.8rem; color: var(--text-dim); font-size: 0.8rem; cursor: pointer; text-decoration: underline; text-align: center;">
        已有契约？直接登入
      </div>
    `;

    let gradeSelected = 0;
    card.querySelectorAll('.tiyvat-btn-opt').forEach(p => p.addEventListener('click', () => {
      card.querySelectorAll('.tiyvat-btn-opt').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      gradeSelected = parseInt(p.getAttribute('data-grade') || '0');
    }));

    card.querySelector('#btn-next')?.addEventListener('click', () => {
      const nick = (card.querySelector('#reg-nickname') as HTMLInputElement).value.trim();
      if (!nick || !gradeSelected) return alert('请先输入名号并选择冒险等阶');
      showStep2(nick, gradeSelected);
    });

    card.querySelector('#go-to-login')?.addEventListener('click', showLogin);
  };

  const showStep2 = (nick: string, grade: number) => {
    clearTimer();
    let smsVerified = false;
    card.innerHTML = `
      ${renderHeader('📜', '通关文牒', '手机号是找回存档的唯一凭证')}
      <div style="margin-bottom: 1.5rem; text-align: left;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">契约账号 (手机号)：</label>
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <input type="tel" id="reg-contact" class="tiyvat-input" placeholder="11位手机号..." style="flex: 1;">
          <button id="btn-send-code" class="btn-secondary" style="white-space: nowrap; font-size: 12px; padding: 0 10px; border-radius: 4px;">发验证码</button>
        </div>
      </div>
      <div id="sms-code-row" style="margin-bottom: 1.5rem; text-align: left; display: none;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">验证码 (6位)：</label>
        <input type="tel" id="reg-sms-code" class="tiyvat-input" placeholder="6位验证码" maxlength="6" style="margin-top: 8px; width: 100%;">
      </div>
      <div style="margin-bottom: 1.5rem; text-align: left;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">秘法口令 (4位 PIN)：</label>
        ${getPinHtml('tiyvat-pin')}
      </div>
      <div style="margin-bottom: 2.5rem; text-align: left;">
        <label style="color: var(--text-dim); font-size: 0.8rem; letter-spacing: 1px;">契约激活码 (Redeem Code)：</label>
        <input type="text" id="reg-activation-code" class="tiyvat-input" placeholder="请输入激活码..." style="margin-top: 8px; width: 100%;" value="DEFAULT_FREE">
      </div>
      <button id="btn-finish" class="btn-primary" style="width: 100%; padding: 15px; border-radius: 4px; border: none; cursor: pointer;">缔结契约 (Launch)</button>
      <div style="display: flex; justify-content: space-between; margin-top: 1.8rem; font-size: 0.8rem;">
        <span id="go-back-step1" style="color: var(--text-dim); cursor: pointer; text-decoration: underline;">返回修改</span>
      </div>
    `;

    const contactInput = card.querySelector('#reg-contact') as HTMLInputElement;
    const sendCodeBtn = card.querySelector('#btn-send-code') as HTMLButtonElement;
    const smsCodeRow = card.querySelector('#sms-code-row') as HTMLElement;
    const inputs = card.querySelectorAll<HTMLInputElement>('.tiyvat-pin');
    bindPinEvents(inputs);

    card.querySelector('#go-back-step1')?.addEventListener('click', showStep1);

    sendCodeBtn.addEventListener('click', async () => {
      const phone = contactInput.value.trim();
      if (validateContact(phone)) return alert(validateContact(phone));
      sendCodeBtn.disabled = true;
      const result = await sendSmsCode(phone);
      if (!result.success) { alert(result.error || '发送失败'); sendCodeBtn.disabled = false; return; }
      smsCodeRow.style.display = 'block';
      let seconds = 60;
      countdownTimer = setInterval(() => {
        seconds--; sendCodeBtn.textContent = `${seconds}s`;
        if (seconds <= 0) { clearTimer(); sendCodeBtn.disabled = false; sendCodeBtn.textContent = '重新发送'; }
      }, 1000);
    });

    card.querySelector('#btn-finish')?.addEventListener('click', async () => {
      const contact = contactInput.value.trim();
      const pin = Array.from(inputs).map(i => i.value).join('');
      const activationCode = (card.querySelector('#reg-activation-code') as HTMLInputElement)?.value.trim();
      if (pin.length < 4) return alert('请输入4位秘法口令');

      if (!smsVerified) {
        const smsCode = (card.querySelector('#reg-sms-code') as HTMLInputElement)?.value.trim();
        const vResult = await verifySmsCode(contact, smsCode);
        if (!vResult.verified) return alert(vResult.message || '验证码错误');
        smsVerified = true;
      }

      const result = await syncRegister({ nickname: nick, grade, contact, pin, checkInStreak: 0, lastCheckInDate: '', totalCheckInDays: 0, masteredTools: [] }, activationCode);
      if (!result.success) return alert(result.error || '注册失败');
      saveUserStats({ nickname: nick, grade, contact, pin, checkInStreak: 0, lastCheckInDate: '', totalCheckInDays: 0, masteredTools: [], expiryAt: result.expiryAt });
      showCelebration();
    });
  };

  const showLogin = () => {
    const savedContact = getUserStats().contact || '';
    const maskedContact = savedContact ? savedContact.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '未知账号';

    card.innerHTML = `
      ${renderHeader('🏮', '归航语文园地', '输入口令唤醒存档')}
      <div style="margin-bottom: 1.5rem; text-align: center; color: var(--text-dim); font-size: 0.9rem;">
        已绑定契约：${maskedContact}
      </div>
      <div style="margin-bottom: 2.5rem;">
        ${getPinHtml('tiyvat-pin-login', 'center')}
      </div>
      <button id="btn-login" class="btn-primary" style="width: 100%; padding: 15px; border-radius: 4px; border: none; cursor: pointer;">确认契约 (Confirm)</button>
      <div style="margin-top: 1.8rem; text-align: center;">
        <span id="go-to-reg" style="color: var(--text-dim); font-size: 0.8rem; cursor: pointer; text-decoration: underline;">切换账号？重新签署</span>
      </div>
    `;

    card.querySelector('#go-to-reg')?.addEventListener('click', showStep1);
    const inputs = card.querySelectorAll<HTMLInputElement>('.tiyvat-pin-login');
    bindPinEvents(inputs);

    card.querySelector('#btn-login')?.addEventListener('click', async () => {
      const pin = Array.from(inputs).map(i => i.value).join('');
      if (pin.length < 4) return alert('请输入完整的 4 位口令');
      
      const data = await syncLogin(savedContact, pin);
      if (data) { applyCloudData(data.user, data.progress); showCelebration(); }
      else { alert('口令错误'); }
    });
  };

  const showCelebration = () => {
    card.innerHTML = `
      <div style="padding: 2.5rem 0; text-align: center;">
        <div style="font-size: 5rem; color: #ffb703; animation: liyueGlow 2s infinite;">💠</div>
        <h2 style="color: #ffb703; font-size: 1.8rem; margin-top: 1rem;">FIXED AS STONE</h2>
        <p style="color: var(--text-dim); margin-top: 0.5rem;">契约已生效，${getUserStats().nickname}</p>
      </div>
    `;
    setTimeout(() => { container.remove(); onComplete(); }, 1500);
  };

  if (!isRegistered) showStep1(); else showLogin();
  container.appendChild(card);
  document.body.appendChild(container);

  if (!document.getElementById('tiyvat-auth-css')) {
    const style = document.createElement('style');
    style.id = 'tiyvat-auth-css';
    style.textContent = `
      .tiyvat-auth-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #111218; z-index: 9999; display: flex; align-items: center; justify-content: center; }
      .tiyvat-card { background: rgba(26, 32, 44, 0.95); border: 1px solid var(--accent-border); padding: 2.5rem 2rem; border-radius: 8px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 0 50px rgba(0,0,0,0.8); }
      .tiyvat-header-icon { font-size: 3rem; margin-bottom: 10px; }
      .tiyvat-header-title { color: #ffb703; font-size: 1.5rem; margin-bottom: 5px; }
      .tiyvat-header-sub { color: #9496a5; font-size: 0.8rem; }
      .tiyvat-input { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px; color: white; border-radius: 4px; outline: none; }
      .tiyvat-input:focus { border-color: #ffb703; }
      .tiyvat-pin-base { width: 3.5rem; height: 3.5rem; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: #ffb703; font-size: 1.5rem; text-align: center; border-radius: 4px; }
      .tiyvat-btn-opt { padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #9496a5; cursor: pointer; border-radius: 4px; }
      .tiyvat-btn-opt.active { border-color: #ffb703; color: #ffb703; background: rgba(255,183,3,0.1); }
      .btn-primary { background: #ffb703; color: #111218; font-weight: bold; }
      .btn-secondary { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; }
      @keyframes liyueGlow { 0%, 100% { filter: drop-shadow(0 0 5px #ffb703); } 50% { filter: drop-shadow(0 0 20px #ffb703); } }
    `;
    document.head.appendChild(style);
  }
}
