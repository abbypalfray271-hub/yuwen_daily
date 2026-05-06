const ADMIN_PASSWORD = '2721';
const SESSION_KEY = 'yuwen_is_admin';

export function isAdmin(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === 'true';
}

export function setAdmin(status: boolean) {
  if (status) {
    sessionStorage.setItem(SESSION_KEY, 'true');
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function verifyPassword(input: string): boolean {
  if (input === ADMIN_PASSWORD) {
    setAdmin(true);
    return true;
  }
  return false;
}
