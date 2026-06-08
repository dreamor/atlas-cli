/**
 * Recon script: probe the manhour/confirm API endpoints
 * Usage: npx tsx scripts/recon-manhour2.ts
 */
import { loadSession } from '../adapters/atlas/auth/session.js';
import { createClient } from '../adapters/atlas/http/client.js';
import type { BanmaClient } from '../adapters/atlas/http/client.js';

async function main() {
  const session = await loadSession();
  if (!session) {
    console.error('No session found. Run `atlas auth login` first.');
    process.exit(1);
  }
  console.log('Session loaded:', session.account, 'empId:', session.empId);
  console.log('BucToken:', session.bucToken ? session.bucToken.substring(0, 10) + '...' : 'EMPTY');
  console.log('Cookies count:', session.cookies.length);

  const client = createClient(session);
  const projectId = '2027';

  // First verify known-good endpoint works
  console.log('\n=== Verifying known-good endpoint ===');
  try {
    const r = await client.request({
      path: '/yuntu-service/line/plan/month/select.json',
      method: 'POST',
      body: { projectId },
      maxRetries: 0,
    });
    const d = r.data as unknown[];
    console.log(`✅ line/plan/month/select.json -> OK (type=array[${d.length}])`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ line/plan/month/select.json -> ERROR: ${msg.substring(0, 200)}`);
    console.log('Session appears expired. Run `atlas auth login` first.');
    process.exit(1);
  }

  console.log('\n=== Probing manhour endpoints ===');
  const endpoints: Array<{ label: string; path: string; method: 'GET' | 'POST'; body?: Record<string, unknown>; query?: Record<string, string> }> = [
    // Based on URL: /manpowers/confirm/projectWeek?month=2026-06&cycle=1&project=2027
    { label: 'manpowers-confirm-projectWeek-POST(project)', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST', body: { month: '2026-06', cycle: 1, project: projectId } },
    { label: 'manpowers-confirm-projectWeek-POST(projectId)', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST', body: { month: '2026-06', cycle: 1, projectId } },
    { label: 'manpowers-confirm-projectWeek-GET', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'GET', query: { month: '2026-06', cycle: '1', project: projectId } },
    { label: 'manpowers-confirm-list-POST', path: '/yuntu-service/manpowers/confirm/list.json', method: 'POST', body: { month: '2026-06', cycle: 1, project: projectId } },
    { label: 'manpowers-confirm-select-POST', path: '/yuntu-service/manpowers/confirm/select.json', method: 'POST', body: { month: '2026-06', cycle: 1, projectId } },
    // Try different body patterns
    { label: 'manpowers-confirm-POST-monthOnly', path: '/yuntu-service/manpowers/confirm/projectWeek.json', method: 'POST', body: { month: '2026-06', project: projectId } },
    // manpower (singular) forms
    { label: 'manpower-confirm-projectWeek-POST', path: '/yuntu-service/manpower/confirm/projectWeek.json', method: 'POST', body: { month: '2026-06', cycle: 1, project: projectId } },
    // Other common naming patterns
    { label: 'manpower-select', path: '/yuntu-service/manpower/select.json', method: 'POST', body: { projectId } },
    { label: 'mpManpower-select', path: '/yuntu-service/mpManpower/select.json', method: 'POST', body: { projectId } },
    { label: 'mpManpower-month-select', path: '/yuntu-service/mpManpower/month/select.json', method: 'POST', body: { projectId } },
    { label: 'manpowerConfirm-select', path: '/yuntu-service/manpowerConfirm/select.json', method: 'POST', body: { projectId } },
    { label: 'manpowerWeek-select', path: '/yuntu-service/manpowerWeek/select.json', method: 'POST', body: { projectId } },
    // Try "actual" or "confirm" naming
    { label: 'manpower-actual-select', path: '/yuntu-service/manpower/actual/select.json', method: 'POST', body: { projectId } },
    { label: 'manpower-actual-month-select', path: '/yuntu-service/manpower/actual/month/select.json', method: 'POST', body: { projectId } },
    { label: 'linePlanManpower-select', path: '/yuntu-service/linePlanManpower/select.json', method: 'POST', body: { projectId } },
    // Try with the exact URL pattern from the page (/manpowers/confirm/projectWeek)
    // The page path is: /manpowers/confirm/projectWeek, so the API might be different from /yuntu-service/...
    // Let's try direct GET requests matching the page URL pattern
    { label: 'manpowers-confirm-projectWeek-noService-GET', path: '/manpowers/confirm/projectWeek.json', method: 'GET', query: { month: '2026-06', cycle: '1', project: projectId } },
  ];

  for (const ep of endpoints) {
    try {
      const result = await client.request({
        path: ep.path,
        method: ep.method,
        body: ep.body,
        ...(ep.query ? { query: ep.query } : {}),
        maxRetries: 0,
      });
      const data = result.data;
      const isArr = Array.isArray(data);
      const type = isArr ? `array[${(data as unknown[]).length}]` : typeof data;
      const preview = JSON.stringify(data).substring(0, 500);
      console.log(`✅ ${ep.label}`);
      console.log(`   ${ep.method} ${ep.path} -> OK (type=${type}, preview=${preview})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ ${ep.label}`);
      console.log(`   ${ep.method} ${ep.path} -> ${msg.substring(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
