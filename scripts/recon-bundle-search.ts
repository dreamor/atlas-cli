/**
 * Static recon: download the SPA's JS bundles and search for manhour-related API endpoints.
 */
import { request } from 'undici';
import { loadSession, buildCookieHeader } from '../adapters/atlas/auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../adapters/atlas/util/paths.js';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const cookieHeader = buildCookieHeader(session.cookies);
  const headers = {
    cookie: cookieHeader,
    'user-agent': session.userAgent || DEFAULT_USER_AGENT,
    accept: 'text/html,*/*',
  };

  // Fetch the SPA index page (known working page that loads JS bundles)
  const url = BASE_URL + '/projects/mpLine/list?projectId=2548';
  console.log('Fetching SPA index:', url);
  const res = await request(url, { method: 'GET', headers });
  const html = await res.body.text();
  console.log('Status:', res.statusCode, 'HTML length:', html.length);

  if (html.includes('<!DOCTYPE html>') && html.includes('login')) {
    console.log('Got login page - session may be expired for web requests');
    console.log('The CLI works differently (uses different auth flow).');
    console.log('Trying a different approach: fetch JS bundles directly with auth headers...');
  }

  // Extract script URLs
  const scripts = new Set<string>();
  const re = /(?:src|href)="([^"]+\.js[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (u) {
      if (u.startsWith('http')) scripts.add(u);
      else if (u.startsWith('/')) scripts.add(BASE_URL + u);
    }
  }
  console.log('Scripts found:', scripts.size);
  for (const s of scripts) console.log('  ', s);

  // Also try the manpowers page
  const url2 = BASE_URL + '/manpowers/confirm/projectWeek?month=2026-06&cycle=1&project=2027';
  console.log('\nFetching manhours page:', url2);
  const res2 = await request(url2, { method: 'GET', headers });
  const html2 = await res2.body.text();
  console.log('Status:', res2.statusCode, 'HTML length:', html2.length);

  // Check if both pages share the same JS bundles
  const scripts2 = new Set<string>();
  while ((m = re.exec(html2)) !== null) {
    const u = m[1];
    if (u) {
      if (u.startsWith('http')) scripts2.add(u);
      else if (u.startsWith('/')) scripts2.add(BASE_URL + u);
    }
  }
  console.log('Manhours page scripts:', scripts2.size);

  // Combine all unique script URLs
  const allScripts = new Set([...scripts, ...scripts2]);
  console.log('Total unique scripts:', allScripts.size);

  // Now fetch each JS bundle and search for manhour-related strings
  const allEndpoints = new Set<string>();
  const manhourPatterns = [
    /["'`](\/yuntu-service\/[a-zA-Z0-9_/.-]*\.json)["'`]/g,
  ];
  const specificSearches = [
    'manpower', 'manpowers', 'confirm', 'projectWeek', 'manHour',
    'actualManpower', 'mpManpower', 'pmpManpower', 'hourConfirm',
    'weekManpower', 'projManpower', 'manpowerWeek', 'manpowerActual',
    'manpowerConfirm', 'manpowerList',
  ];

  let fetched = 0;
  const visited = new Set<string>();
  const queue = [...allScripts];

  while (queue.length > 0 && fetched < 200) {
    const scriptUrl = queue.shift()!;
    if (visited.has(scriptUrl)) continue;
    visited.add(scriptUrl);
    fetched++;

    try {
      const jsRes = await request(scriptUrl, { method: 'GET', headers });
      const js = await jsRes.body.text();
      const fileName = scriptUrl.substring(scriptUrl.lastIndexOf('/') + 1);

      // Extract dynamic imports
      const importRe = /["'](\/assets\/[A-Za-z0-9._/-]+\.js)["']/g;
      let importMatch: RegExpExecArray | null;
      while ((importMatch = importRe.exec(js)) !== null) {
        const chunk = BASE_URL + importMatch[1];
        if (!visited.has(chunk)) queue.push(chunk);
      }

      // Search for endpoints
      for (const pat of manhourPatterns) {
        let epMatch: RegExpExecArray | null;
        pat.lastIndex = 0;
        while ((epMatch = pat.exec(js)) !== null) {
          if (epMatch[1]) allEndpoints.add(epMatch[1]);
        }
      }

      // Search for specific keywords in context
      for (const keyword of specificSearches) {
        const idx = js.indexOf(keyword);
        if (idx >= 0) {
          // Extract surrounding context (200 chars on each side)
          const start = Math.max(0, idx - 100);
          const end = Math.min(js.length, idx + keyword.length + 200);
          const context = js.substring(start, end).replace(/\n/g, ' ');
          console.log(`\n  [${fileName}] Found "${keyword}" at ${idx}:`);
          console.log(`    ...${context}...`);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Silently skip errors
    }
  }

  console.log(`\n\n=== All endpoints found (${allEndpoints.size}) ===`);
  const sorted = [...allEndpoints].sort();
  for (const ep of sorted) console.log(`  ${ep}`);

  // Filter for manhour-related
  const manhourEndpoints = sorted.filter(ep =>
    /manpower|confirm|week|actual|hour/i.test(ep)
  );
  console.log(`\n=== Manhour-related endpoints (${manhourEndpoints.length}) ===`);
  for (const ep of manhourEndpoints) console.log(`  ${ep}`);
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
