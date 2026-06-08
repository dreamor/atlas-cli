/**
 * Recon script: probe the manhour/confirm API endpoints
 * Usage: npx tsx scripts/recon-manhour.ts
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';

async function probe() {
  const session = await loadSession();
  if (!session) {
    console.error('No session found. Run `atlas auth login` first.');
    process.exit(1);
  }
  const client = createClient(session);
  const projectId = '2027';

  const endpoints = [
    // Based on the URL: /manpowers/confirm/projectWeek
    { label: 'manpowers-confirm-projectWeek-POST-project', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST' as const, body: { month: '2026-06', cycle: 1, project: projectId } },
    { label: 'manpowers-confirm-projectWeek-POST-projectId', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST' as const, body: { month: '2026-06', cycle: 1, projectId } },
    { label: 'manpowers-confirm-list-POST', path: '/yuntu-service/manpowers/confirm/list.json', method: 'POST' as const, body: { month: '2026-06', cycle: 1, project: projectId } },
    { label: 'manpowers-confirm-select-POST', path: '/yuntu-service/manpowers/confirm/select.json', method: 'POST' as const, body: { month: '2026-06', cycle: 1, projectId } },
    { label: 'manpowers-confirm-projectWeek-GET', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'GET' as const, query: { month: '2026-06', cycle: '1', project: projectId } },
    // manpower (singular)
    { label: 'manpower-confirm-projectWeek-POST', path: '/yuntu-service/manpower/confirm/projectWeek.json', method: 'POST' as const, body: { month: '2026-06', cycle: 1, project: projectId } },
    // Other common patterns
    { label: 'manpower-select-POST', path: '/yuntu-service/manpower/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpower-month-select-POST', path: '/yuntu-service/manpower/month/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpower-actual-select-POST', path: '/yuntu-service/manpower/actual/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpower-actual-month-select-POST', path: '/yuntu-service/manpower/actual/month/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'mpManpower-select-POST', path: '/yuntu-service/mpManpower/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'mpManpower-month-select-POST', path: '/yuntu-service/mpManpower/month/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpowerWeek-select-POST', path: '/yuntu-service/manpowerWeek/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpower-week-select-POST', path: '/yuntu-service/manpower/week/select.json', method: 'POST' as const, body: { projectId } },
    { label: 'manpowerConfirm-select-POST', path: '/yuntu-service/manpowerConfirm/select.json', method: 'POST' as const, body: { projectId } },
    // Try different body patterns for projectWeek
    { label: 'manpowers-projectWeek-no-cycle', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST' as const, body: { month: '2026-06', projectId } },
    { label: 'manpowers-projectWeek-month-only', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST' as const, body: { month: '2026-06' } },
  ];

  console.log(`Probing ${endpoints.length} endpoints with project=${projectId}...\n`);

  for (const ep of endpoints) {
    try {
      const result = await client.request({
        path: ep.path,
        method: ep.method,
        body: ep.body,
        ...(ep.query ? { query: ep.query } : {}),
        maxRetries: 0,
      });
      const dataStr = JSON.stringify(result.data);
      const isArr = Array.isArray(result.data);
      const type = isArr ? `array[${(result.data as unknown[]).length}]` : typeof result.data;
      console.log(`✅ ${ep.label}`);
      console.log(`   ${ep.method} ${ep.path} -> OK (type=${type}, len=${dataStr.length})`);
      console.log(`   preview: ${dataStr.substring(0, 500)}`);
      console.log();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ ${ep.label}`);
      console.log(`   ${ep.method} ${ep.path} -> ${msg.substring(0, 200)}`);
      console.log();
    }
  }
}

probe().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
