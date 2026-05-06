import { UserStats } from '../types';

const KEYS = {
  USER_STATS: 'yuwen_user_stats',
  PROGRESS_PREFIX: 'yuwen_progress_',
};

export function getUserStats(): UserStats {
  const data = localStorage.getItem(KEYS.USER_STATS);
  if (data) return JSON.parse(data);
  return {
    nickname: '',
    grade: 0,
    contact: '',
    pin: '',
    checkInStreak: 0,
    lastCheckInDate: '',
    totalCheckInDays: 0,
    masteredTools: [],
  };
}

export function saveUserStats(stats: UserStats) {
  localStorage.setItem(KEYS.USER_STATS, JSON.stringify(stats));
}

export function getProgress(dayId: string): any {
  const data = localStorage.getItem(KEYS.PROGRESS_PREFIX + dayId);
  return data ? JSON.parse(data) : null;
}

export function saveProgress(dayId: string, data: any) {
  localStorage.setItem(KEYS.PROGRESS_PREFIX + dayId, JSON.stringify(data));
}

export function getAllProgress(): Record<string, any> {
  const result: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEYS.PROGRESS_PREFIX)) {
      const dayId = key.replace(KEYS.PROGRESS_PREFIX, '');
      result[dayId] = JSON.parse(localStorage.getItem(key)!);
    }
  }
  return result;
}

export function clearAllLocalData() {
  localStorage.clear();
}

export function saveDayOverride(dayId: string, content: Record<string, string>) {
  localStorage.setItem(`day_override_${dayId}`, JSON.stringify(content));
}

export function getDayOverride(dayId: string): Record<string, string> | null {
  const data = localStorage.getItem(`day_override_${dayId}`);
  return data ? JSON.parse(data) : null;
}
export const isCourseLocked = (dayId: string) => localStorage.getItem(`lock_${dayId}`) === 'true';
export const setCourseLock = (dayId: string, locked: boolean) => {
  if (locked) localStorage.setItem(`lock_${dayId}`, 'true');
  else localStorage.removeItem(`lock_${dayId}`);
};

export function clearDayOverride(dayId: string) {
  localStorage.removeItem(`day_override_${dayId}`);
}
