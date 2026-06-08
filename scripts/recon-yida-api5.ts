/**
 * Recon round 5: Capture the full response from getProjMpConfirmDetail and
 * other working endpoints to understand the data model.
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { request } from 'undici';
import { writeFile } from 'node:fs/promises';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const projectId = '2027';
  const staffId = session.empId;

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

  interface ApiResponse {
    status?: string | number;
    code?: number;
    errCode?: string | number;
    errorMsg?: string | null;
    success?: boolean;
    data?: unknown;
  }

  async function rawGet(label: string, path: string, queryParams: Record<string, string | number>): Promise<ApiResponse | null> {
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${BASE_URL}${path}?${qs}`;
    try {
      const res = await request(url, { method: 'GET', headers });
      const text = await res.body.text();
      try {
        const json = JSON.parse(text) as ApiResponse;
        return json;
      } catch {
        console.log(`❌ ${label}: Non-JSON response (${res.statusCode})`);
        return null;
      }
    } catch (e: unknown) {
      console.log(`❌ ${label}: ${(e instanceof Error ? e.message : String(e)).substring(0, 200)}`);
      return null;
    }
  }

  const results: Record<string, ApiResponse | null> = {};

  // 1. getProjMpConfirmDetail - this one returned data!
  console.log('Fetching getProjMpConfirmDetail with status=0 (pending)...');
  results['getProjMpConfirmDetail_status0'] = await rawGet(
    'getProjMpConfirmDetail_status0',
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    { month: '2026-06', projectList: projectId, staff_ID: staffId, status: 0 },
  );

  console.log('Fetching getProjMpConfirmDetail with status=1 (approved)...');
  results['getProjMpConfirmDetail_status1'] = await rawGet(
    'getProjMpConfirmDetail_status1',
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    { month: '2026-06', projectList: projectId, staff_ID: staffId, status: 1 },
  );

  // 2. getTeamProjectConfirmByProjectId
  console.log('Fetching getTeamProjectConfirmByProjectId with status=0...');
  results['getTeamProjectConfirmByProjectId_status0'] = await rawGet(
    'getTeamProjectConfirmByProjectId_status0',
    '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    { month: '2026-06', projectId, status: 0 },
  );

  console.log('Fetching getTeamProjectConfirmByProjectId with status=1...');
  results['getTeamProjectConfirmByProjectId_status1'] = await rawGet(
    'getTeamProjectConfirmByProjectId_status1',
    '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    { month: '2026-06', projectId, status: 1 },
  );

  // 3. getProjectManpowerDetail
  console.log('Fetching getProjectManpowerDetail...');
  results['getProjectManpowerDetail_2026-06'] = await rawGet(
    'getProjectManpowerDetail_2026-06',
    '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    { month: '2026-06', staff_ID: staffId },
  );

  // Try different months to find data
  for (const month of ['2026-05', '2025-12', '2025-06']) {
    results[`getProjectManpowerDetail_${month}`] = await rawGet(
      `getProjectManpowerDetail_${month}`,
      '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
      { month, staff_ID: staffId },
    );
  }

  // 4. getManpowerApprovalsByStaffId
  console.log('Fetching getManpowerApprovalsByStaffId...');
  results['getManpowerApprovalsByStaffId'] = await rawGet(
    'getManpowerApprovalsByStaffId',
    '/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json',
    { staff_ID: staffId, month: '2026-06' },
  );

  // Write all results
  const output: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(results)) {
    if (result && result.success) {
      output[key] = result.data;
      const data = result.data;
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`✅ ${key}: ${type}`);
    } else if (result) {
      output[key] = { _error: true, status: result.status, code: result.code, errorMsg: result.errorMsg };
      console.log(`⚠️  ${key}: error=${result.errorMsg}`);
    } else {
      output[key] = { _error: true, _network: true };
      console.log(`❌ ${key}: network error`);
    }
  }

  await writeFile('/tmp/recon-manhour-api-results.json', JSON.stringify(output, null, 2));
  console.log('\nFull results written to /tmp/recon-manhour-api-results.json');
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
