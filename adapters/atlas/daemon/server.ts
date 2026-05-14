import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Browser } from 'playwright';
import { loadPlaywright } from '../util/playwright-loader.js';

const DEFAULT_PORT = 8765;

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

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${DEFAULT_PORT}`);

  // CORS - 仅允许本地请求
  const origin = req.headers.origin ?? '';
  if (origin === '' || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
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

    if (url.pathname === '/api/login') {
      session = await loginWithPlaywright();
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
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not authenticated' }));
        return;
      }

      const body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
      });

      const { method, path, data } = JSON.parse(body);

      // 转发到后端
      const targetUrl = `https://banma-yuntu.alibaba-inc.com${path}`;
      const response = await fetch(targetUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Cookie: buildCookieHeader(session.cookies),
          'User-Agent': session.userAgent,
          'x-banma-empId': session.empId,
          'x-banma-account': session.account,
          'x-banma-token': session.bucToken,
        },
        body: method !== 'GET' ? JSON.stringify(data) : undefined,
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

  server.listen(port, () => {
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