/**
 * Recon: verify the /yida/manpower/ API endpoints discovered from SPA bundle analysis.
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const client = createClient(session);
  const projectId = '2027';

  // Verify known-good endpoint
  console.log('Verifying session...');
  try {
    const r = await client.request({
      path: '/yuntu-service/line/plan/month/select.json',
      method: 'POST',
      body: { projectId },
      maxRetries: 0,
    });
    console.log('✅ Session valid. Known endpoint works.\n');
  } catch (e: unknown) {
    console.log('❌ Session expired. Run atlas auth login.');
    process.exit(1);
  }

  // The hr base path = /yuntu-service
  // The manpower API prefix = /yuntu-service/yida/manpower/
  const endpoints = [
    // GET endpoints with query params
    {
      label: 'getProjectManpowerDetail',
      path: '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
      method: 'GET' as const,
      query: { month: '2026-06', staff_ID: session.empId },
    },
    {
      label: 'getProjMpConfirmDetail',
      path: '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
      method: 'GET' as const,
      query: { month: '2026-06', projectList: projectId, staff_ID: session.empId },
    },
    {
      label: 'getTeamProjectConfirmByProjectId',
      path: '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
      method: 'GET' as const,
      query: { month: '2026-06', projectId: projectId, status: '0' },
    },
    {
      label: 'getTeamProjectConfirmByProjectId-status1',
      path: '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
      method: 'GET' as const,
      query: { month: '2026-06', projectId: projectId, status: '1' },
    },
    {
      label: 'getTeamProjectConfirmByProjectId-all',
      path: '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
      method: 'GET' as const,
      query: { month: '2026-06', projectId: projectId },
    },
    {
      label: 'confirmProjectManpowerDetail',
      path: '/yuntu-service/yida/manpower/confirmProjectManpowerDetail.json',
      method: 'GET' as const,
      query: { month: '2026-06', ids: '', staff_ID: session.empId },
    },
    {
      label: 'getManpowerApprovalsByStaffId',
      path: '/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json',
      method: 'GET' as const,
      query: {},
    },
    {
      label: 'getProjectManpowerDetailChangeLog',
      path: '/yuntu-service/yida/manpower/getProjectManpowerDetailChangeLog.json',
      method: 'GET' as const,
      query: { month: '2026-06', projectId: projectId },
    },
    // Try with different month formats
    {
      label: 'getProjMpConfirmDetail-month202606',
      path: '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
      method: 'GET' as const,
      query: { month: '202606', projectList: projectId, staff_ID: session.empId },
    },
  ];

  console.log(`Probing ${endpoints.length} /yida/manpower/ endpoints...\n`);

  for (const ep of endpoints) {
    try {
      const result = await client.request({
        path: ep.path,
        method: ep.method,
        query: ep.query,
        maxRetries: 0,
      });
      const data = result.data;
      const isArr = Array.isArray(data);
      const isObj = typeof data === 'object' && data !== null && !isArr;
      let type = isArr ? `array[${(data as unknown[]).length}]` : typeof data;
      if (isObj) {
        const keys = Object.keys(data as Record<string, unknown>);
        type = `object{${keys.slice(0, 10).join(',')}}`;
      }
      const preview = JSON.stringify(data).substring(0, 600);
      console.log(`✅ ${ep.label}`);
      console.log(`   ${ep.method} ${ep.path}`);
      console.log(`   query: ${JSON.stringify(ep.query)}`);
      console.log(`   -> ${type}`);
      console.log(`   preview: ${preview}`);
      console.log();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('[banma:')) {
        // API returned a structured error - endpoint EXISTS but wrong params
        console.log(`⚠️  ${ep.label}`);
        console.log(`   ${ep.method} ${ep.path}`);
        console.log(`   query: ${JSON.stringify(ep.query)}`);
        console.log(`   -> API ERROR (endpoint exists!): ${msg.substring(0, 300)}`);
        console.log();
      } else if (msg.includes('302') || msg.includes('Non-JSON')) {
        console.log(`❌ ${ep.label} -> redirect (endpoint not found)`);
      } else {
        console.log(`❌ ${ep.label} -> ${msg.substring(0, 200)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
