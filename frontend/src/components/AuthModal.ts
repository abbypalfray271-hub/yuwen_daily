import { verifyPassword } from '../utils/auth';

export function showAuthModal(onSuccess: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'tiyvat-auth-overlay fade-in';
  overlay.style.zIndex = '10000';

  const card = document.createElement('div');
  card.className = 'tiyvat-card';
  card.style.width = '300px';

  card.innerHTML = `
    <h3 style="margin-bottom: 1.5rem; color: #ffb703;">输入管理暗号</h3>
    <input type="password" id="admin-pass-input" class="tiyvat-input" placeholder="请输入暗号..." 
      style="width: 100%; text-align: center; font-size: 1.2rem; margin-bottom: 1.5rem;">
    <div style="display: flex; gap: 10px;">
      <button id="auth-cancel" class="btn-secondary" style="flex: 1; padding: 10px;">取消</button>
      <button id="auth-confirm" class="btn-primary" style="flex: 1; padding: 10px;">进入</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const input = card.querySelector('#admin-pass-input') as HTMLInputElement;
  input.focus();

  const handleAuth = () => {
    if (verifyPassword(input.value)) {
      overlay.remove();
      onSuccess();
    } else {
      input.style.borderColor = 'red';
      input.value = '';
      input.placeholder = '暗号错误';
    }
  };

  card.querySelector('#auth-confirm')!.addEventListener('click', handleAuth);
  card.querySelector('#auth-cancel')!.addEventListener('click', () => overlay.remove());
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAuth(); });
}
