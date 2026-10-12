export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface StoredSession {
  user: AuthUser;
  token: string;
}

const STORAGE_KEY = 'echoes_session';

export function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.user || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getAuthToken(): string | null {
  return readStoredSession()?.token ?? null;
}
