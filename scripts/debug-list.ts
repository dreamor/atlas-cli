import { request } from 'undici';
import { loadSession, buildCookieHeader } from '../adapters/atlas/auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../adapters/atlas/util/paths.js';

async function call(label: string, path: string, method: 'GET' | 'POST', body: unknown) {
  const session = await loadSession();
  if (!session) throw new Error('no session');

  const headers: Record<string, string> = {
    token: session.bucToken,
    'x-banma-token': session.bucToken,
    'x-banma-staff-id': String(session.empId),
    'x-banma-user': session.account,
    'x-banma-company-id': session.companyId ?? '',
    'user-agent': session.userAgent || DEFAULT_USER_AGENT,
    cookie: buildCookieHeader(session.cookies),
    accept: 'application/json, text/plain, */*',
  };
  if (method === 'POST') headers['content-type'] = 'application/json';

  const url = `${BASE_URL}${path}`;
  const res = await request(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await res.body.text();
  console.log(`\n=== ${label} ===`);
  console.log('status:', res.statusCode);
  console.log('first 1500 chars of body:');
  console.log(text.slice(0, 1500));
}

const pid = process.argv[2] ?? '2548';

await call('line/plan/select string', '/yuntu-service/line/plan/select.json', 'POST', { projectId: String(pid) });
await call('line/plan/select number', '/yuntu-service/line/plan/select.json', 'POST', { projectId: Number(pid) });
await call('line/plan/month/select', '/yuntu-service/line/plan/month/select.json', 'POST', { projectId: String(pid) });
await call('queryProjById', `/yuntu-service/projApi/queryProjById.json?projId=${pid}`, 'GET', null);
await call('myPage/getMyTaskNum', '/yuntu-service/myPage/getMyTaskNum.json', 'POST', {});
await call('selectHasPermisValidProject', '/yuntu-service/project/selectHasPermisValidProject.json', 'POST', {});
