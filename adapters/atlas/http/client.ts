import { request } from 'undici';
import {
  EnvelopeSchema,
  isEnvelopeSuccess,
  type Envelope,
} from '../schema/envelope.js';
import {
  BanmaApiError,
  SessionExpiredError,
} from '../util/errors.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../util/paths.js';
import { buildCookieHeader, type Session } from '../auth/session.js';
import { checkDaemon, daemonExec } from '../daemon/client.js';
import { isSandboxCached } from '../util/sandbox.js';

export interface RequestOptions {
  readonly path: string;
  readonly method?: 'GET' | 'POST';
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly maxRetries?: number;
}

export interface BanmaClient {
  request<T = unknown>(opts: RequestOptions): Promise<{ envelope: Envelope; data: T }>;
  rawJson<T = unknown>(opts: RequestOptions): Promise<T>;
}

export function createClient(session: Session): BanmaClient {
  const ua = session.userAgent || DEFAULT_USER_AGENT;
  const cookieHeader = buildCookieHeader(session.cookies);

  function authHeaders(): Record<string, string> {
    return {
      token: session.bucToken,
      'x-banma-token': session.bucToken,
      'x-banma-staff-id': String(session.empId),
      'x-banma-user': session.account,
      'x-banma-company-id': session.companyId ?? '',
      'user-agent': ua,
      cookie: cookieHeader,
      accept: 'application/json, text/plain, */*',
    };
  }

  async function doRequest(opts: RequestOptions): Promise<Envelope> {
    const url = buildUrl(opts.path, opts.query);
    const method = opts.method ?? 'POST';

    // Check if running in sandbox and if daemon is available
    const isSandboxEnv = await isSandboxCached();
    if (isSandboxEnv) {
      const isDaemon = await checkDaemon();
      if (isDaemon) {
      const result = await daemonExec(method, opts.path, opts.body);
      if (result.status >= 400) {
        throw new BanmaApiError({
          errCode: String(result.status),
          errorMsg: `HTTP ${result.status}`,
          httpStatus: result.status,
          path: opts.path,
        });
      }
      const parsed = result.data as Record<string, unknown>;
      const env = EnvelopeSchema.parse(parsed);
      if (!isEnvelopeSuccess(env)) {
        const errCode = String(env.errCode ?? env.code ?? 'unknown');
        const msg = env.errorMsg ?? 'Unknown banma API error';
        throw new BanmaApiError({
          errCode,
          errorMsg: msg,
          httpStatus: result.status,
          path: opts.path,
        });
      }
      return env;
      }
      // Sandbox env but daemon not running
      throw new Error(
        'Detected sandbox environment but daemon is not running.\n' +
        'Please start the daemon first: atlas daemon',
      );
    }

    const headers: Record<string, string> = {
      ...authHeaders(),
      ...(opts.headers ?? {}),
    };

    let bodyPayload: string | undefined;
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      bodyPayload = JSON.stringify(opts.body ?? {});
    }

    const maxRetries = opts.maxRetries ?? 3;
    let attempt = 0;
    let lastErr: unknown;

    while (attempt <= maxRetries) {
      try {
        const res = await request(url, {
          method,
          headers,
          body: bodyPayload,
        });

        // Detect SSO redirect (undici follows 0 redirects only when explicitly set,
        // but default for `request` is 0 → 3xx surfaces here).
        if (res.statusCode >= 300 && res.statusCode < 400) {
          const loc = String(res.headers['location'] ?? '');
          if (/buc|login|sso/i.test(loc)) {
            throw new SessionExpiredError('Got redirect to BUC');
          }
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          throw new SessionExpiredError(`HTTP ${res.statusCode}`);
        }

        if (res.statusCode === 429 || res.statusCode >= 500) {
          await backoff(attempt);
          attempt += 1;
          lastErr = new Error(`HTTP ${res.statusCode}`);
          continue;
        }

        if (res.statusCode >= 400) {
          const text = await res.body.text();
          throw new BanmaApiError({
            errCode: String(res.statusCode),
            errorMsg: `HTTP ${res.statusCode}: ${text.slice(0, 200)}`,
            httpStatus: res.statusCode,
            path: opts.path,
          });
        }

        const text = await res.body.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new BanmaApiError({
            errCode: 'PARSE',
            errorMsg: `Non-JSON response: ${text.slice(0, 200)}`,
            httpStatus: res.statusCode,
            path: opts.path,
          });
        }

        const env = EnvelopeSchema.parse(parsed);
        if (!isEnvelopeSuccess(env)) {
          const errCode = String(env.errCode ?? env.code ?? 'unknown');
          const msg = env.errorMsg ?? 'Unknown banma API error';
          throw new BanmaApiError({
            errCode,
            errorMsg: msg,
            httpStatus: res.statusCode,
            path: opts.path,
          });
        }
        return env;
      } catch (err) {
        if (err instanceof SessionExpiredError || err instanceof BanmaApiError) {
          throw err;
        }
        lastErr = err;
        if (attempt >= maxRetries) break;
        await backoff(attempt);
        attempt += 1;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Request failed');
  }

  return {
    async request<T>(opts: RequestOptions) {
      const envelope = await doRequest(opts);
      return { envelope, data: envelope.data as T };
    },
    async rawJson<T>(opts: RequestOptions) {
      // Same as request, but returns just data
      const env = await doRequest(opts);
      return env.data as T;
    },
  };
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function backoff(attempt: number): Promise<void> {
  const baseMs = 250;
  const cap = 4000;
  const exp = Math.min(cap, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * exp);
  await new Promise((r) => setTimeout(r, jitter));
}
