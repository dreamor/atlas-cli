import { mkdir, writeFile, readFile, unlink, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
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

/** Zod schema for runtime validation of session data (prevents injection). */
const sessionSchema = z.object({
  empId: z.string().min(1),
  account: z.string().min(1),
  bucToken: z.string(),
  companyId: z.string(),
  userAgent: z.string().min(1),
  savedAt: z.string().min(1),
  cookies: z.array(z.object({
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.string().optional(),
  })),
});

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
  // Validate session before persisting
  sessionSchema.parse(session);

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
  // Atomic write: write to temp then rename to prevent partial reads
  const tmp = `${SESSION_FILE}.tmp.${Date.now()}`;
  await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, SESSION_FILE);
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
    await unlink(SESSION_FILE);
  } catch {
    // ignore (file may not exist)
  }
}

function parseSession(raw: string): Session | null {
  try {
    const obj = JSON.parse(raw);
    // Use Zod for full validation (prevents injection / malformed data)
    const validated = sessionSchema.parse(obj);
    return validated;
  } catch {
    return null;
  }
}

/** Check if a cookie name or value could be used for header injection. */
function isSafeCookieValue(s: string): boolean {
  // Reject CRLF injection and semicolons that would break cookie syntax
  return !/[;\r\n]/.test(s);
}

/** Build a `Cookie` header from session cookie jar. */
export function buildCookieHeader(cookies: readonly CookieEntry[]): string {
  return cookies
    .filter((c) => c.name && c.value !== undefined)
    .filter((c) => isSafeCookieValue(c.name) && isSafeCookieValue(c.value))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
