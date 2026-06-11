import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser } from 'playwright';
import { loadPlaywright } from '../util/playwright-loader.js';

const DEFAULT_PORT = 8765;
const TARGET_API_HOST = 'banma-yuntu.alibaba-inc.com';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', `localhost:${DEFAULT_PORT}`, `127.0.0.1:${DEFAULT_PORT}`]);

interface Session {
  empId: string;
  account: string;
  bucToken: string;
  companyId: string;
  userAgent: string;
  cookies: unknown[];
  savedAt: string;
}

let browser: Browser | null = null;
let session: Session | null = null;

let loginContext: import('playwright').BrowserContext | null = null;
let loginInProgress = false;
let loginResolve: ((s: Session) => void) | null = null;

let authToken = '';

async function loginWithPlaywright(): Promise<Session> {
  // 如果已经有登录的 context，直接使用
  if (loginContext) {
    const cookies = await loginContext.cookies();
    const pages = loginContext.pages();
    const firstPage = pages[0];
    if (firstPage) {
      const localStorageStr = await firstPage.evaluate('() => JSON.stringify(localStorage)');
      return extractSession(cookies, localStorageStr as string);
    }
  }

  try {
    browser = await (await loadPlaywright('daemon')).chromium.launch({ headless: false });
    loginContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    const page = await loginContext.newPage();

    const targetUrl = 'https://banma-yuntu.alibaba-inc.com/';
    await page.goto(targetUrl);

    console.log('请在浏览器中完成登录...');
    console.log('登录完成后保持浏览器打开，后续请求会自动使用这个 session');

    // 等待用户登录完成（检测 cookie 出现）
    await page.waitForFunction(
      '() => document.cookie.includes("yuntun_sid") || document.cookie.includes("loginToken")',
      { timeout: 0 },
    ).catch(() => {
      console.log('等待登录超时，请重试');
    });

    const cookies = await loginContext.cookies();
    const localStorageStr = await page.evaluate('() => JSON.stringify(localStorage)');

    // 不要关闭浏览器，保持登录状态
    // browser 会在 daemon 关闭时一起关闭

    return extractSession(cookies, localStorageStr as string);
  } catch (err) {
    // Clean up on failure so resources don't leak
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
      browser = null;
      loginContext = null;
    }
    throw err;
  }
}

function extractSession(cookies: import('playwright').Cookie[], localStorageStr: string): Session {
  let empId = 'unknown';
  let account = 'unknown';
  let bucToken = '';
  let companyId = '';

  if (localStorageStr && localStorageStr !== 'null') {
    try {
      const parsed: unknown = JSON.parse(localStorageStr as string);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        empId = String(obj.empId ?? obj.userId ?? 'unknown');
        account = String(obj.account ?? obj.nickName ?? 'unknown');
        bucToken = String(obj.bucToken ?? '');
        companyId = String(obj.companyId ?? '');
      }
    } catch {
      // 使用默认值
    }
  }

  return {
    empId,
    account,
    bucToken,
    companyId,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    cookies,
    savedAt: new Date().toISOString(),
  };
}

function buildCookieHeader(cookies: unknown[]): string {
  return cookies
    .map((c: unknown) => {
      const cookie = c as { name: string; value: string };
      return `${cookie.name}=${cookie.value}`;
    })
    .join('; ');
}

/** Generate or read a per-instance shared secret for daemon auth. */
async function ensureToken(): Promise<string> {
  if (authToken) return authToken;
  const tokenPath = `${process.env.HOME ?? '/tmp'}/.config/atlas/daemon.token`;
  try {
    authToken = (await readFile(tokenPath, 'utf8')).trim();
    return authToken;
  } catch {
    authToken = randomBytes(32).toString('hex');
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, authToken, { encoding: 'utf8', mode: 0o600 });
    return authToken;
  }
}

/** Return 401 if Authorization header is missing or wrong. */
async function authenticateRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const expected = await ensureToken();
  const header = req.headers['authorization'] ?? '';
  // Bearer token or bare-token — accept both for ergonomics
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
  if (got !== expected) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}

/** Check that the origin header is an allowed local origin (empty = non-browser). */
function isLocalOrigin(origin: string): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ALLOWED_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${DEFAULT_PORT}`);

  // CORS: only reflect origin for known local origins; deny otherwise
  const origin = req.headers.origin ?? '';
  if (!isLocalOrigin(origin)) {
    if (origin) {
      // Reject non-local origins
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden origin' }));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Status endpoint is public (no auth required)
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: session ? 'authenticated' : 'not_authenticated',
        empId: session?.empId ?? null,
        account: session?.account ?? null,
      }),
    );
    return;
  }

  // All other endpoints require auth
  if (!(await authenticateRequest(req, res))) return;

  try {
    if (url.pathname === '/api/login') {
      if (loginInProgress) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'login already in progress' }));
        return;
      }
      loginInProgress = true;
      try {
        session = await loginWithPlaywright();
      } finally {
        loginInProgress = false;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, empId: session.empId }));
      return;
    }

    if (url.pathname === '/api/cookies') {
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not authenticated' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cookies: session.cookies }));
      return;
    }

    if (url.pathname === '/api/exec') {
      const body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
      });

      const parsed = JSON.parse(body);
      const execMethod: string = parsed.method ?? 'GET';
      const execPath: string = parsed.path ?? '/';
      const execData: unknown = parsed.data;

      // SSRF protection: validate method (check BEFORE session — always enforced)
      const ALLOWED_METHODS = new Set(['GET', 'POST']);
      if (!ALLOWED_METHODS.has(execMethod.toUpperCase())) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `method not allowed: ${execMethod}` }));
        return;
      }

      // SSRF protection: validate path starts with / and doesn't escape target host
      if (!execPath.startsWith('/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path must start with /' }));
        return;
      }
      const execUrl = new URL(execPath, `https://${TARGET_API_HOST}`);
      if (execUrl.host !== TARGET_API_HOST) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid host in path' }));
        return;
      }

      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not authenticated' }));
        return;
      }

      // 转发到后端
      const targetUrl = `https://${TARGET_API_HOST}${execPath}`;
      const response = await fetch(targetUrl, {
        method: execMethod,
        headers: {
          'Content-Type': 'application/json',
          Cookie: buildCookieHeader(session.cookies),
          'User-Agent': session.userAgent,
          'x-banma-empId': session.empId,
          'x-banma-account': session.account,
          'x-banma-token': session.bucToken,
        },
        body: execMethod !== 'GET' ? JSON.stringify(execData) : undefined,
      });

      const responseData = await response.text();
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(responseData);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

export async function startDaemon(port: number = DEFAULT_PORT): Promise<void> {
  const server = createServer(handleRequest);

  // CRITICAL: Bind only to loopback — never expose to the network
  server.listen(port, '127.0.0.1', () => {
    console.log(`🚀 Atlas daemon running at http://localhost:${port}`);
    console.log(`   API endpoints:`);
    console.log(`   - GET  /api/status     # 检查认证状态`);
    console.log(`   - POST /api/login     # 启动登录流程`);
    console.log(`   - GET  /api/cookies   # 获取当前 cookie`);
    console.log(`   - POST /api/exec      # 执行 API 请求`);
  });

  // 保持进程运行
  process.stdin.resume();
}