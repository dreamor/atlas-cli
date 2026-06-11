import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';

const DEFAULT_PORT = 8765;
const CONFIG_DIR = `${process.env.HOME ?? '/tmp'}/.config/atlas`;
const TOKEN_FILE = `${CONFIG_DIR}/daemon.token`;

let cachedToken: string | null = null;

/** Read the daemon auth token from disk (lazy cache). */
async function getAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = (await readFile(TOKEN_FILE, 'utf8')).trim();
  } catch {
    cachedToken = '';
  }
  return cachedToken;
}

export interface DaemonStatus {
  status: 'authenticated' | 'not_authenticated';
  empId: string | null;
  account: string | null;
}

export interface DaemonCookies {
  cookies: unknown[];
}

export interface DaemonExecResult {
  data?: unknown;
  error?: string;
}

const isProduction = process.env.NODE_ENV !== 'development';

function getBaseUrl(): string {
  const port = process.env.ATLAS_DAEMON_PORT || String(DEFAULT_PORT);
  return `http://localhost:${port}`;
}

async function httpRequestPromise(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: string }> {
  // Inject auth token into every request
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;

    const req = requester(
      url,
      {
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data }));
      },
    );

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function checkDaemon(): Promise<boolean> {
  try {
    const port = process.env.ATLAS_DAEMON_PORT || String(DEFAULT_PORT);
    const url = `http://localhost:${port}/api/status`;
    const response = await httpRequestPromise(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function getDaemonStatus(): Promise<DaemonStatus | null> {
  try {
    const url = `${getBaseUrl()}/api/status`;
    const response = await httpRequestPromise(url);
    if (response.status !== 200) return null;
    return JSON.parse(response.data) as DaemonStatus;
  } catch {
    return null;
  }
}

export async function daemonLogin(): Promise<{ success: boolean; empId?: string; error?: string }> {
  try {
    const url = `${getBaseUrl()}/api/login`;
    const response = await httpRequestPromise(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.status !== 200) {
      return { success: false, error: response.data };
    }
    return JSON.parse(response.data);
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getDaemonCookies(): Promise<unknown[] | null> {
  try {
    const url = `${getBaseUrl()}/api/cookies`;
    const response = await httpRequestPromise(url);
    if (response.status !== 200) return null;
    const result = JSON.parse(response.data) as DaemonCookies;
    return result.cookies;
  } catch {
    return null;
  }
}

export async function daemonExec(
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${getBaseUrl()}/api/exec`;
  const body = JSON.stringify({ method, path, data });

  const response = await httpRequestPromise(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(response.data);
  } catch {
    parsedData = response.data;
  }

  return { status: response.status, data: parsedData };
}

export async function isDaemonMode(): Promise<boolean> {
  if (process.env.ATLAS_DAEMON === 'true') return true;
  return checkDaemon();
}