/**
 * Recon round 3: Focus on getProjMpConfirmDetail and getTeamProjectConfirmByProjectId
 * with precise parameter formatting.
 *
 * From SPA bundle analysis:
 * - getProjMpConfirmDetail: params { month, projectList, staff_ID }
 * - getTeamProjectConfirmByProjectId: params { month, projectId, status }
 * - getProjectManpowerDetail: params { month, staff_ID }
 * - The SPA code shows month is formatted as "YYYY-MM" (e.g., "2026-06")
 *   via Pr(r.contentObj.month, "YYYY-MM").valueOf()
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const client = createClient(session);
  const projectId = '2027';
  const staffId = session.empId;

  console.log(`Session: ${session.account} empId=${staffId}\n`);

  // Helper to make GET requests with query params
  async function tryGet(label: string, path: string, query: Record<string, string>) {
    try {
      const result = await client.request({
        path,
        method: 'GET',
        query,
        maxRetries: 0,
      });
      const data = result.data;
      const type = Array.isArray(data)
        ? `array[${(data as unknown[]).length}]`
        : typeof data === 'object' && data !== null
          ? `object{${Object.keys(data as Record<string, unknown>).slice(0, 10).join(',')}}`
          : typeof data;
      const preview = JSON.stringify(data).substring(0, 1000);
      console.log(`✅ ${label}`);
      console.log(`   GET ${path}`);
      console.log(`   params: ${JSON.stringify(query)}`);
      console.log(`   -> ${type}`);
      console.log(`   data: ${preview}`);
      console.log();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ ${label} -> ${msg.substring(0, 500)}`);
      console.log();
    }
  }

  // getProjMpConfirmDetail - this one gave us the most useful error before
  console.log('=== getProjMpConfirmDetail ===');
  // The SPA code: ge.get(`${hr}/yida/manpower/getProjMpConfirmDetail.json`,{params:{month:ye,projectList:Ae,staff_ID:hl()}})
  // ye = month string, Ae = projectList (might be comma-separated), hl() = staff ID function
  await tryGet('basic', '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    { month: '2026-06', projectList: '2027', staff_ID: staffId });

  // Maybe projectList is a different format - try comma-separated project IDs
  await tryGet('projectList-comma', '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    { month: '2026-06', projectList: '[2027]', staff_ID: staffId });

  // Maybe we need a different month format?
  await tryGet('month-no-dash', '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    { month: '202606', projectList: '2027', staff_ID: staffId });

  // What if projectList is a JSON array?
  // The SPA code seems to pass it as projectList directly

  // getTeamProjectConfirmByProjectId
  console.log('=== getTeamProjectConfirmByProjectId ===');
  // The SPA code: ge.get(`${hr}/yida/manpower/getTeamProjectConfirmByProjectId.json`,{params:{month:Ae,projectId:ye,status:De}})
  // De is the status parameter (might be 0=pending, 1=approved, 2=rejected?)
  // Try with numeric status values
  for (const status of ['0', '1', '2', '3']) {
    await tryGet(`status=${status}`, '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
      { month: '2026-06', projectId: projectId, status });
  }

  // Without status to see if it returns all
  await tryGet('no-status', '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    { month: '2026-06', projectId: projectId });

  // getProjectManpowerDetail - per-staff, per-month detail
  console.log('=== getProjectManpowerDetail ===');
  // The SPA code: ge.get(`${hr}/yida/manpower/getProjectManpowerDetail.json`,{params:{month:ye,staff_ID:hl()}})
  await tryGet('with-staff', '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    { month: '2026-06', staff_ID: staffId });
  await tryGet('different-month', '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    { month: '2026-05', staff_ID: staffId });
  await tryGet('2025-12', '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    { month: '2025-12', staff_ID: staffId });

  // confirmProjectManpowerDetail - this is per-month approval detail
  console.log('=== confirmProjectManpowerDetail ===');
  // ge.get(`${hr}/yida/manpower/confirmProjectManpowerDetail.json`,{params:{month:ye,ids:Ae,staff_ID:hl()}})
  // ids might be a comma-separated list of IDs
  await tryGet('empty-ids', '/yuntu-service/yida/manpower/confirmProjectManpowerDetail.json',
    { month: '2026-06', ids: '', staff_ID: staffId });

  // getManpowerApprovalsByStaffId
  console.log('=== getManpowerApprovalsByStaffId ===');
  // No explicit params in the SPA code - might just need query params
  await tryGet('basic', '/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json',
    { staff_ID: staffId });
  await tryGet('with-month', '/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json',
    { staff_ID: staffId, month: '2026-06' });
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
