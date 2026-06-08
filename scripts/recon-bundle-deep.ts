/**
 * Deep search of the SPA JS bundle for manpower/confirm/week related code.
 * We found "manpowerWeeklyDTOs" - now search for the actual API endpoint.
 */
import { request } from 'undici';
import { loadSession, buildCookieHeader } from '../adapters/atlas/auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../adapters/atlas/util/paths.js';
import { writeFile } from 'node:fs/promises';

async function main() {
  const session = await loadSession();
  if (!session) { console.log('No session'); process.exit(1); }
  const cookieHeader = buildCookieHeader(session.cookies);
  const headers = {
    cookie: cookieHeader,
    'user-agent': session.userAgent || DEFAULT_USER_AGENT,
    accept: 'text/html,*/*',
  };

  // Fetch the main bundle - we know it's at assets/index-CoeHsioo.js
  const bundleUrl = BASE_URL + '/assets/index-CoeHsioo.js';
  console.log('Fetching main bundle:', bundleUrl);
  const res = await request(bundleUrl, { method: 'GET', headers });
  const js = await res.body.text();
  console.log('Bundle size:', js.length, 'bytes');

  // Search for all occurrences of "manpower" in context
  const keywords = [
    'manpowerWeek',
    'manpowerWeekly',
    'manpowerDTOs',
    'WeeklyDTO',
    'projectWeek',
    'manpowers/confirm',
    'manpowers/',
    '/confirm/',
    'confirm/projectWeek',
    'manpowerConfirm',
    'manpowerList',
    'mpConfirm',
    'pmpManpower',
    'actualManpower',
    'manHour',
    'weekSelect',
    'weekConfirm',
    'confirmWeek',
    'weekList',
    'manpowerWeekList',
    'confirmList',
    '/confirm/',
  ];

  for (const keyword of keywords) {
    let idx = 0;
    let count = 0;
    while ((idx = js.indexOf(keyword, idx)) !== -1) {
      count++;
      const start = Math.max(0, idx - 150);
      const end = Math.min(js.length, idx + keyword.length + 300);
      const context = js.substring(start, end).replace(/\n/g, ' ');
      console.log(`\n[${keyword}] at ${idx}:`);
      console.log(`  ...${context}...`);
      idx += keyword.length;
    }
    if (count === 0) console.log(`\n[${keyword}] NOT FOUND`);
  }

  // Specific search: look for the API path patterns near "manpower" mentions
  // The SPA typically uses axios/fetch with a base URL prefix
  console.log('\n\n=== Searching for API path patterns near manpower keywords ===');

  // Find all /yuntu-service/ or similar patterns within 500 chars of any manpower mention
  const manpowerIdx = js.indexOf('manpower');
  if (manpowerIdx >= 0) {
    // Search a wide window around each manpower mention
    let searchStart = 0;
    const apiPatterns: string[] = [];
    while (searchStart < js.length) {
      const mpIdx = js.indexOf('manpower', searchStart);
      if (mpIdx < 0) break;

      const window = js.substring(Math.max(0, mpIdx - 1000), Math.min(js.length, mpIdx + 1000));

      // Look for API path patterns in this window
      const apiRe = /["'`](\/[a-zA-Z][a-zA-Z0-9_/.-]*\.json)["'`]/g;
      let apiMatch: RegExpExecArray | null;
      while ((apiMatch = apiRe.exec(window)) !== null) {
        if (apiMatch[1] && !apiPatterns.includes(apiMatch[1])) {
          apiPatterns.push(apiMatch[1]);
        }
      }

      // Also look for URL template patterns like `${tt}/xxx`
      const ttRe = /`\$\{tt\}\/([^`]+)`/g;
      let ttMatch: RegExpExecArray | null;
      while ((ttMatch = ttRe.exec(window)) !== null) {
        if (ttMatch[1] && !apiPatterns.includes('/yuntu-service/' + ttMatch[1])) {
          apiPatterns.push('/yuntu-service/' + ttMatch[1]);
        }
      }

      // Look for we.post, we.get patterns with the path
      const postRe = /we\.(post|get|put|delete)\(\s*`?\$\{tt\}\/([^`"'()]+)`?/g;
      let postMatch: RegExpExecArray | null;
      while ((postMatch = postRe.exec(window)) !== null) {
        const path = '/yuntu-service/' + postMatch[2];
        if (!apiPatterns.includes(path)) apiPatterns.push(path);
      }

      searchStart = mpIdx + 10;
    }

    console.log('API patterns found near "manpower" mentions:');
    for (const p of apiPatterns) console.log(`  ${p}`);
  }

  // Also search for the router definition - the /manpowers/confirm path
  console.log('\n\n=== Searching for /manpowers route definition ===');
  const routeIdx = js.indexOf('/manpowers');
  if (routeIdx >= 0) {
    const ctx = js.substring(Math.max(0, routeIdx - 200), Math.min(js.length, routeIdx + 500));
    console.log(ctx.replace(/\n/g, ' '));
  } else {
    console.log('"/manpowers" route NOT FOUND in bundle');
  }

  // Write the full bundle for offline searching
  await writeFile('/tmp/atlas-bundle.js', js);
  console.log('\nFull bundle written to /tmp/atlas-bundle.js');
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
