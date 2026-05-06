import { UserStats } from '../types';
import { getUserStats, getAllProgress, saveUserStats, saveProgress } from './storage';

const API_BASE = '/api';

export async function sendSmsCode(phone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    return res.ok ? { success: true } : { success: false, error: data.error };
  } catch {
    return { success: false, error: '网络故障' };
  }
}

export async function verifySmsCode(phone: string, code: string): Promise<{ verified: boolean; message?: string }> {
  try {
    const res = await fetch(`${API_BASE}/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    return await res.json();
  } catch {
    return { verified: false, message: '验证失败' };
  }
}

export async function syncRegister(stats: UserStats, activationCode: string): Promise<{ success: boolean; error?: string; expiryAt?: string }> {
  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...stats, activationCode }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return { success: true, expiryAt: data.expiryAt };
  } catch {
    return { success: false, error: '注册失败' };
  }
}

export async function syncLogin(contact: string, pin: string): Promise<{ user: UserStats; progress: Record<string, any> } | null> {
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact, pin }),
    });
    if (res.status === 403) {
      const data = await res.json();
      window.dispatchEvent(new CustomEvent('auth_error', { detail: data }));
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function pushSync(): Promise<void> {
  const stats = getUserStats();
  const progress = getAllProgress();
  if (!stats.contact) return;
  try {
    const res = await fetch(`${API_BASE}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: stats.contact, stats, progress }),
    });
    if (res.status === 403) {
      const data = await res.json();
      window.dispatchEvent(new CustomEvent('auth_error', { detail: data }));
    }
  } catch (e) {
    console.warn('Sync failed', e);
  }
}

export function applyCloudData(user: UserStats, progress: Record<string, any>) {
  saveUserStats(user);
  for (const [dayId, data] of Object.entries(progress)) {
    saveProgress(dayId, data);
  }
}
