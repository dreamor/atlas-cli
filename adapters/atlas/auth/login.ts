import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { BASE_URL, TARGET_HOST } from '../util/paths.js';
import { saveSession, type CookieEntry, type Session } from './session.js';
import { UserInfoSchema } from '../schema/models.js';

const USER_DATA_DIR = resolve(process.cwd(), '.playwright/user-data');

export interface LoginResult {
  readonly session: Session;
  readonly via: 'keytar' | 'file';
}

/** Headed Playwright login flow. Opens browser, lets user complete SSO,
 * polls `/user/info` until it returns 200, then persists session.
 */
export async function runLogin(opts: {
  readonly entryPath?: string;
  readonly timeoutMs?: number;
}): Promise<LoginResult> {
  await mkdir(USER_DATA_DIR, { recursive: true });
  const isFirstRun = !existsSync(resolve(USER_DATA_DIR, 'Default'));

  const context: BrowserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const entry = opts.entryPath ?? '/projects/mpLine/list';
    await page.goto(`${BASE_URL}${entry}`, { waitUntil: 'domcontentloaded' });

    if (isFirstRun) {
      printSsoInstructions();
    }

    const userInfo = await pollUserInfo(context, opts.timeoutMs ?? 5 * 60 * 1000);

    const cookies = await context.cookies();
    const jar: CookieEntry[] = cookies
      .filter((c) => c.domain.includes('alibaba-inc.com') || c.domain.includes(TARGET_HOST))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));

    const ua = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      () => (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '',
    );

    const session: Session = {
      empId: String(userInfo.emp_id),
      account: userInfo.account,
      bucToken: userInfo.token,
      companyId: '',
      userAgent: ua,
      cookies: jar,
      savedAt: new Date().toISOString(),
    };

    const { via } = await saveSession(session);
    return { session, via };
  } finally {
    await context.close();
  }
}

async function pollUserInfo(context: BrowserContext, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const apiUrl = `${BASE_URL}/user/info`;

  while (Date.now() < deadline) {
    try {
      const res = await context.request.get(apiUrl, {
        headers: { accept: 'application/json' },
      });
      if (res.ok()) {
        const json = (await res.json()) as { data?: unknown };
        const parsed = UserInfoSchema.safeParse(json.data);
        if (parsed.success) return parsed.data;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for SSO. Did you complete login in the browser?');
}

function printSsoInstructions(): void {
  const banner = `
================================================================================
  Banma SSO login — first run
--------------------------------------------------------------------------------
  Complete corp SSO + 2FA in the browser window that just opened.
  Once the mpLine page renders, return to this terminal — login will complete
  automatically. Cookies are persisted in .playwright/user-data/.
================================================================================
`;
  // eslint-disable-next-line no-console
  console.log(banner);
}
