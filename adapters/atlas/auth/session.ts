import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CONFIG_DIR,
  KEYTAR_ACCOUNT,
  KEYTAR_SERVICE,
  SESSION_FILE,
} from '../util/paths.js';
import { getDaemonStatus, getDaemonCookies } from '../daemon/client.js';
import { DEFAULT_USER_AGENT } from '../util/paths.js';

export interface CookieEntry {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: string;
}

export interface Session {
  readonly empId: string;
  readonly account: string;
  readonly bucToken: string;
  readonly companyId: string;
  readonly userAgent: string;
  readonly cookies: readonly CookieEntry[];
  readonly savedAt: string; // ISO
}

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    const mod = (await import('keytar')) as unknown as {
      default?: KeytarLike;
    } & KeytarLike;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function saveSession(session: Session): Promise<{ via: 'keytar' | 'file' }> {
  const payload = JSON.stringify(session);
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, payload);
      return { via: 'keytar' };
    } catch {
      // fall through to file
    }
  }
  await ensureConfigDir();
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, payload, { encoding: 'utf8' });
  await chmod(SESSION_FILE, 0o600);
  return { via: 'file' };
}

export async function loadSession(): Promise<Session | null> {
  // First try to load from daemon if running
  const daemonSession = await loadSessionFromDaemon();
  if (daemonSession) {
    return daemonSession;
  }

  // Fall back to local storage (keytar or file)
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      if (raw) return parseSession(raw);
    } catch {
      // fall through to file
    }
  }
  try {
    const raw = await readFile(SESSION_FILE, 'utf8');
    return parseSession(raw);
  } catch {
    return null;
  }
}

/** Load session from daemon if it's running and authenticated. */
export async function loadSessionFromDaemon(): Promise<Session | null> {
  try {
    const status = await getDaemonStatus();
    if (!status || status.status !== 'authenticated') {
      return null;
    }

    const cookies = await getDaemonCookies();
    if (!cookies || cookies.length === 0) {
      return null;
    }

    // Convert daemon cookies to Session format
    // 注意：daemon 模式下不暴露 bucToken，仅使用 cookie 进行认证
    // 部分需要 token 的 API 可能无法使用
    return {
      empId: status.empId ?? 'unknown',
      account: status.account ?? 'unknown',
      bucToken: '',
      companyId: '',
      userAgent: DEFAULT_USER_AGENT,
      cookies: cookies as Session['cookies'],
      savedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    } catch {
      // ignore
    }
  }
  try {
    await writeFile(SESSION_FILE, '', { encoding: 'utf8' });
  } catch {
    // ignore
  }
}

function parseSession(raw: string): Session | null {
  try {
    const obj = JSON.parse(raw) as Session;
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.empId || !obj.account || !obj.bucToken || !Array.isArray(obj.cookies)) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

/** Build a `Cookie` header from session cookie jar. */
export function buildCookieHeader(cookies: readonly CookieEntry[]): string {
  return cookies
    .filter((c) => c.name && c.value !== undefined)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
