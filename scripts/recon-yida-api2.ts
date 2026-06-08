/**
 * Recon round 2: verify /yida/manpower/ endpoints with corrected params.
 * Key finding from round 1: endpoints exist, need correct param format.
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';
import type { BanmaClient } from '../adapters/atlas/http/client.js';

async function tryEndpoint(
  client: BanmaClient,
  label: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string | number>,
) {
  try {
    const result = await client.request({
      path,
      method,
      ...(method === 'GET' ? { query: params as Record<string, string> } : { body: params }),
      maxRetries: 0,
    });
    const data = result.data;
    const isArr = Array.isArray(data);
    const isObj = typeof data === 'object' && data !== null && !isArr;
    let type = isArr ? `array[${(data as unknown[]).length}]` : typeof data;
    if (isObj) {
      const keys = Object.keys(data as Record<string, unknown>);
      type = `object{${keys.slice(0, 15).join(',')}}`;
    }
    const preview = JSON.stringify(data).substring(0, 800);
    console.log(`✅ ${label}`);
    console.log(`   ${method} ${path}`);
    console.log(`   params: ${JSON.stringify(params)}`);
    console.log(`   -> ${type}`);
    console.log(`   preview: ${preview}`);
    console.log();
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('[banma:')) {
      console.log(`⚠️  ${label} -> API error: ${msg.substring(0, 400)}`);
      console.log(`   ${method} ${path}  params: ${JSON.stringify(params)}`);
      console.log();
    } else if (msg.includes('302') || msg.includes('Non-JSON')) {
      console.log(`❌ ${label} -> redirect/not found`);
    } else {
      console.log(`❌ ${label} -> ${msg.substring(0, 200)}`);
    }
    return { success: false };
  }
}

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const client = createClient(session);
  const projectId = '2027';
  const staffId = session.empId;

  console.log(`Session: ${session.account} empId=${staffId}\n`);

  // === getTeamProjectConfirmByProjectId ===
  // status: number (not string). Try different values.
  console.log('=== getTeamProjectConfirmByProjectId ===');

  // Try without status (might return all)
  await tryEndpoint(client, 'no-status',
    '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    'GET', { month: '2026-06', projectId });

  // Try different months
  for (const month of ['2025-01', '2025-06', '2025-12', '2026-01', '2026-03', '2026-05']) {
    await tryEndpoint(client, `month=${month}`,
      '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
      'GET', { month, projectId });
  }

  // === getProjMpConfirmDetail ===
  // Requires: month, projectList, staff_ID, and likely status (as number)
  console.log('\n=== getProjMpConfirmDetail ===');
  await tryEndpoint(client, 'with-status=0',
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    'GET', { month: '2026-06', projectList: projectId, staff_ID: staffId, status: '0' });
  await tryEndpoint(client, 'with-status=1',
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    'GET', { month: '2026-06', projectList: projectId, staff_ID: staffId, status: '1' });

  // === getProjectManpowerDetail ===
  // This might require different params. Try without staff_ID, with different month formats
  console.log('\n=== getProjectManpowerDetail ===');
  await tryEndpoint(client, 'month=2026-06-no-staff',
    '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    'GET', { month: '2026-06' });
  await tryEndpoint(client, 'month=202606',
    '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    'GET', { month: '202606', staff_ID: staffId });

  // === getProjectManpowerDetailChangeLog ===
  console.log('\n=== getProjectManpowerDetailChangeLog ===');
  await tryEndpoint(client, 'with-projectId',
    '/yuntu-service/yida/manpower/getProjectManpowerDetailChangeLog.json',
    'GET', { month: '2026-05', projectId });

  // === approveMonthManpower === (POST endpoint)
  console.log('\n=== approveMonthManpower (POST) ===');
  await tryEndpoint(client, 'empty-body',
    '/yuntu-service/yida/manpower/approveMonthManpower.json',
    'POST', {});

  // === confirmProjectManpowerDetailByStaffIds === (POST with FormData)
  console.log('\n=== confirmProjectManpowerDetailByStaffIds ===');
  // This is a POST with FormData - try empty params first to see the error
  await tryEndpoint(client, 'empty-body',
    '/yuntu-service/yida/manpower/confirmProjectManpowerDetailByStaffIds.json',
    'POST', {});
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
