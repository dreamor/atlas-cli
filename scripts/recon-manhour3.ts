import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const client = createClient(session);
  const projectId = '2027';

  // Verify session works
  try {
    const r = await client.request({ path: '/yuntu-service/line/plan/month/select.json', method: 'POST', body: { projectId }, maxRetries: 0 });
    console.log('Session valid. Known endpoint returns data type:', Array.isArray(r.data) ? 'array' : typeof r.data);
  } catch (e: unknown) {
    console.log('Session expired. Run atlas auth login.');
    process.exit(1);
  }

  const attempts = [
    // pmpManpower (Project Manpower)
    { path: '/yuntu-service/pmpManpower/confirm/projectWeek.json', body: { month: '2026-06', cycle: 1, project: projectId } },
    { path: '/yuntu-service/pmpManpower/select.json', body: { projectId } },
    { path: '/yuntu-service/pmpManpower/month/select.json', body: { projectId } },
    { path: '/yuntu-service/pmpManpower/week/select.json', body: { projectId } },
    { path: '/yuntu-service/pmpManpower/confirm/select.json', body: { projectId, month: '2026-06' } },
    { path: '/yuntu-service/pmpManpower/confirm/list.json', body: { projectId, month: '2026-06' } },
    // manpowerConfirm
    { path: '/yuntu-service/manpowerConfirm/projectWeek.json', body: { month: '2026-06', cycle: 1, project: projectId } },
    { path: '/yuntu-service/manpowerConfirm/select.json', body: { projectId } },
    // projectManpower
    { path: '/yuntu-service/projectManpower/confirm/projectWeek.json', body: { month: '2026-06', cycle: 1, project: projectId } },
    { path: '/yuntu-service/projectManpower/select.json', body: { projectId } },
    // projectWeek
    { path: '/yuntu-service/projectWeek/select.json', body: { projectId, month: '2026-06' } },
    // manHours
    { path: '/yuntu-service/manHours/select.json', body: { projectId } },
    // mpWeek
    { path: '/yuntu-service/mpWeek/select.json', body: { projectId } },
    // hourConfirm
    { path: '/yuntu-service/hourConfirm/select.json', body: { projectId } },
    // confirmHour
    { path: '/yuntu-service/confirmHour/select.json', body: { projectId } },
    // manPower (camelCase)
    { path: '/yuntu-service/manPower/confirm/projectWeek.json', body: { month: '2026-06', cycle: 1, project: projectId } },
    { path: '/yuntu-service/manPower/select.json', body: { projectId } },
    // pmpProjectTeam already known
    { path: '/yuntu-service/pmpProjectTeam/select.json', body: { projectId } },
    // manpowers (plural with 's' at end like URL)
    { path: '/yuntu-service/manpowers/confirm/select.json', body: { projectId, month: '2026-06', cycle: 1 } },
    { path: '/yuntu-service/manpowers/confirm/list.json', body: { projectId, month: '2026-06', cycle: 1 } },
    { path: '/yuntu-service/manpowers/select.json', body: { projectId } },
    // mpManpower (mp = manpower)
    { path: '/yuntu-service/mpManpower/select.json', body: { projectId } },
    { path: '/yuntu-service/mpManpower/confirm/select.json', body: { projectId } },
    // Try body patterns with different keys
    { path: '/yuntu-service/manpowers/confirm/projectWeek.json', body: { month: '2026-06', cycle: 1, projectId } },
    { path: '/yuntu-service/manpowers/confirm/projectWeek.json', body: { month: '2026-06', cycle: '1', project: projectId } },
    // projApi style - maybe it's under a different namespace
    { path: '/yuntu-service/projManpower/select.json', body: { projectId } },
    { path: '/yuntu-service/projManpower/week/select.json', body: { projectId } },
  ];

  console.log(`\nProbing ${attempts.length} endpoints...\n`);

  for (const ep of attempts) {
    try {
      const result = await client.request({ path: ep.path, method: 'POST', body: ep.body, maxRetries: 0 });
      const data = result.data;
      const isArr = Array.isArray(data);
      const type = isArr ? `array[${(data as unknown[]).length}]` : typeof data;
      const preview = JSON.stringify(data).substring(0, 400);
      console.log(`✅ ${ep.path}`);
      console.log(`   body: ${JSON.stringify(ep.body)} -> ${type}`);
      console.log(`   preview: ${preview}`);
      console.log();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('302') || msg.includes('Non-JSON')) {
        console.log(`⤵️  ${ep.path} -> redirect (endpoint may not exist)`);
      } else if (msg.includes('[banma:')) {
        // API returned an error - this means the endpoint EXISTS
        console.log(`⚠️  ${ep.path} -> API error (endpoint exists!)`);
        console.log(`   body: ${JSON.stringify(ep.body)}`);
        console.log(`   error: ${msg.substring(0, 300)}`);
        console.log();
      } else {
        console.log(`❌ ${ep.path} -> ${msg.substring(0, 150)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
