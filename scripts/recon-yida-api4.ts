/**
 * Recon round 4: Fix the status parameter issue.
 * The getProjMpConfirmDetail endpoint expects status as a number, not string.
 * The CLI's client.request passes query params as strings. Need to verify if
 * sending status as a numeric value in the URL works.
 *
 * Also try getTeamProjectConfirmByProjectId with different approaches.
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';
import { request } from 'undici';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const client = createClient(session);
  const projectId = '2027';
  const staffId = session.empId;

  console.log(`Session: ${session.account} empId=${staffId}\n`);

  // The issue: when we use client.request with query params, all values are strings.
  // But the Zod schema expects status as a number.
  // Solution: embed the numeric status directly in the URL path or use a raw request.

  // Let's use the raw undici request to construct URLs with numeric query params
  const BASE_URL = 'https://banma-yuntu.alibaba-inc.com';
  const cookieHeader = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const headers = {
    'token': session.bucToken,
    'x-banma-token': session.bucToken,
    'x-banma-staff-id': String(session.empId),
    'x-banma-user': session.account,
    'x-banma-company-id': session.companyId ?? '',
    'user-agent': session.userAgent,
    'cookie': cookieHeader,
    'accept': 'application/json, text/plain, */*',
  };

  async function rawGet(path: string, queryParams: Record<string, string | number>) {
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${BASE_URL}${path}?${qs}`;
    try {
      const res = await request(url, { method: 'GET', headers });
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = String(res.headers['location'] ?? '');
        console.log(`❌ ${path}?${qs} -> 302 redirect to ${loc.substring(0, 80)}`);
        await res.body.text();
        return null;
      }
      const text = await res.body.text();
      try {
        const json = JSON.parse(text);
        if (json.success === false || json.status !== 1) {
          console.log(`⚠️  ${path}?${qs} -> API error: ${JSON.stringify(json).substring(0, 300)}`);
          return json;
        }
        console.log(`✅ ${path}?${qs}`);
        console.log(`   type: ${Array.isArray(json.data) ? 'array[' + json.data.length + ']' : typeof json.data}`);
        console.log(`   data: ${JSON.stringify(json.data).substring(0, 1000)}`);
        return json.data;
      } catch {
        console.log(`❌ ${path} -> Non-JSON: ${text.substring(0, 200)}`);
        return null;
      }
    } catch (e: unknown) {
      console.log(`❌ ${path} -> Error: ${(e instanceof Error ? e.message : String(e)).substring(0, 200)}`);
      return null;
    }
  }

  // getProjMpConfirmDetail with numeric status
  console.log('=== getProjMpConfirmDetail (with numeric status) ===');
  for (const status of [0, 1, 2]) {
    await rawGet('/yuntu-service/yida/manpower/getProjMpConfirmDetail.json', {
      month: '2026-06',
      projectList: projectId,
      staff_ID: staffId,
      status, // numeric!
    });
  }

  // getTeamProjectConfirmByProjectId with numeric status
  console.log('\n=== getTeamProjectConfirmByProjectId (with numeric status) ===');
  for (const status of [0, 1, 2]) {
    await rawGet('/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json', {
      month: '2026-06',
      projectId: projectId,
      status, // numeric!
    });
  }

  // Without status
  await rawGet('/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json', {
    month: '2026-06',
    projectId: projectId,
  });

  // getProjectManpowerDetail
  console.log('\n=== getProjectManpowerDetail ===');
  await rawGet('/yuntu-service/yida/manpower/getProjectManpowerDetail.json', {
    month: '2026-06',
    staff_ID: staffId,
  });

  // Different months to find data
  for (const month of ['2026-05', '2026-04', '2026-03', '2025-12']) {
    await rawGet('/yuntu-service/yida/manpower/getProjectManpowerDetail.json', {
      month,
      staff_ID: staffId,
    });
  }

  // getManpowerApprovalsByStaffId with different months
  console.log('\n=== getManpowerApprovalsByStaffId (different months) ===');
  for (const month of ['2026-06', '2026-05', '2026-04', '2025-12']) {
    await rawGet('/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json', {
      staff_ID: staffId,
      month,
    });
  }

  // getProjectManpowerDetailChangeLog
  console.log('\n=== getProjectManpowerDetailChangeLog ===');
  await rawGet('/yuntu-service/yida/manpower/getProjectManpowerDetailChangeLog.json', {
    month: '2026-06',
    projectId: projectId,
  });
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
