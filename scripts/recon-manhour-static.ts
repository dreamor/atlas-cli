#!/usr/bin/env -S node --import tsx
/**
 * Static recon for manhour/confirm area: fetch the SPA's JS chunks from
 * the /manpowers/confirm/projectWeek page and grep for endpoint patterns.
 *
 * Usage:
 *   npx tsx scripts/recon-manhour-static.ts
 */

import { request } from 'undici';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSession, buildCookieHeader } from '../adapters/atlas/auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../adapters/atlas/util/paths.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const RECON_DIR = resolve(REPO_ROOT, '.opencli/recon');
const MANHOUR_ENDPOINTS_OUT = resolve(RECON_DIR, 'manhour-static-endpoints.txt');
const MANHOUR_JSFILES_OUT = resolve(RECON_DIR, 'manhour-static-jsfiles.txt');

interface FetchHeaders extends Record<string, string> {
  cookie: string;
  'user-agent': string;
}

async function buildHeaders(): Promise<FetchHeaders> {
  const session = await loadSession();
  if (!session) throw new Error('No session — run `auth login` first.');
  return {
    cookie: buildCookieHeader(session.cookies),
    'user-agent': session.userAgent || DEFAULT_USER_AGENT,
    accept: 'text/html,application/javascript,*/*',
  };
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await request(url, { method: 'GET', headers, maxRedirections: 0 });
  // Follow 302 redirects manually for SSO
  if (res.statusCode >= 300 && res.statusCode < 400) {
    const loc = res.headers['location'];
    if (typeof loc === 'string' && loc) {
      console.log(`  redirect: ${res.statusCode} -> ${loc.substring(0, 80)}`);
      // consume body
      await res.body.text();
      const next = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
      return fetchText(next, headers);
    }
  }
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode} for ${url}`);
  return res.body.text();
}

function extractScriptUrls(html: string): string[] {
  const urls = new Set<string>();
  const re = /(?:src|href)=["']([^"']+\.js[^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (!u) continue;
    if (u.startsWith('http')) urls.add(u);
    else if (u.startsWith('/')) urls.add(`${BASE_URL}${u}`);
  }
  return [...urls];
}

function extractDynamicImports(jsText: string): string[] {
  const urls = new Set<string>();
  const re = /["'](\/assets\/[A-Za-z0-9._/-]+\.js)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsText)) !== null) {
    if (m[1]) urls.add(`${BASE_URL}${m[1]}`);
  }
  return [...urls];
}

function extractEndpoints(jsText: string): string[] {
  const found = new Set<string>();
  // Match strings ending in .json under /yuntu-service/ or /banma-service/
  const reJson = /["'`](\/(?:yuntu|banma|api)[A-Za-z0-9_./-]*?\.json)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = reJson.exec(jsText)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  // REST-style paths
  const reRest = /["'`](\/(?:yuntu-service|banma-service)\/[A-Za-z0-9_./-]+?)["'`]/g;
  while ((m = reRest.exec(jsText)) !== null) {
    if (m[1] && !m[1].includes('${')) found.add(m[1]);
  }
  // Also look for manpower/manpowerConfirm specific patterns
  const reManhour = /["'`](\/[A-Za-z0-9_./-]*[Mm]anpower[A-Za-z0-9_./-]*?\.json)["'`]/g;
  while ((m = reManhour.exec(jsText)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  // Week/confirm related
  const reConfirm = /["'`](\/[A-Za-z0-9_./-]*[Cc]onfirm[A-Za-z0-9_./-]*?\.json)["'`]/g;
  while ((m = reConfirm.exec(jsText)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  // projectWeek related
  const reWeek = /["'`](\/[A-Za-z0-9_./-]*[Ww]eek[A-Za-z0-9_./-]*?\.json)["'`]/g;
  while ((m = reWeek.exec(jsText)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

async function main(): Promise<void> {
  await mkdir(RECON_DIR, { recursive: true });
  await writeFile(MANHOUR_ENDPOINTS_OUT, '');
  await writeFile(MANHOUR_JSFILES_OUT, '');

  const headers = await buildHeaders();

  // Fetch from the manhours/confirm page
  const startUrls = [
    `${BASE_URL}/manpowers/confirm/projectWeek?month=2026-06&cycle=1&project=2027`,
    `${BASE_URL}/manpowers/confirm/projectWeek`,
  ];

  const visited = new Set<string>();
  const queue: string[] = [];
  const allEndpoints = new Set<string>();
  let fetched = 0;

  for (const startUrl of startUrls) {
    console.log(`[1/4] Fetching index HTML: ${startUrl}`);
    try {
      const html = await fetchText(startUrl, headers);
      const initialScripts = extractScriptUrls(html);
      console.log(`     found ${initialScripts.length} initial <script src=...>`);
      for (const s of initialScripts) if (!visited.has(s)) queue.push(s);
    } catch (err) {
      console.log(`     ERROR: ${(err as Error).message}`);
    }
  }

  // BFS through JS chunks (up to 300 files, 2 hops)
  console.log(`[2/4] BFS through JS chunks...`);
  while (queue.length > 0 && fetched < 300) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    fetched++;
    try {
      const js = await fetchText(url, headers);
      const newChunks = extractDynamicImports(js);
      for (const c of newChunks) if (!visited.has(c)) queue.push(c);
      const eps = extractEndpoints(js);
      for (const e of eps) allEndpoints.add(e);
      await appendFile(MANHOUR_JSFILES_OUT, `${url}  size=${js.length}  chunks=${newChunks.length}  endpoints=${eps.length}\n`);
      if (fetched % 20 === 0) console.log(`     [${fetched}] visited, queue=${queue.length}, endpoints=${allEndpoints.size}`);
    } catch (err) {
      await appendFile(MANHOUR_JSFILES_OUT, `${url}  ERROR ${(err as Error).message}\n`);
    }
  }

  console.log(`[3/4] Fetched ${fetched} JS files. Discovered ${allEndpoints.size} endpoint strings.`);

  // Categorize
  const sorted = [...allEndpoints].sort();
  const writeKeyword = /(insert|update|delete|save|create|edit|remove|modify|add|submit|import|batch|confirm|approve)/i;
  const writes = sorted.filter((p) => writeKeyword.test(p));
  const reads = sorted.filter((p) => !writeKeyword.test(p));

  await writeFile(
    MANHOUR_ENDPOINTS_OUT,
    [
      `# Static recon — manhour/confirm endpoints discovered in SPA bundles`,
      `# Total: ${sorted.length}    write/confirm-related: ${writes.length}    other: ${reads.length}`,
      ``,
      `## WRITE/CONFIRM endpoints`,
      ...writes.map((p) => `  ${p}`),
      ``,
      `## Other endpoints (likely reads / metadata)`,
      ...reads.map((p) => `  ${p}`),
      ``,
    ].join('\n'),
  );

  console.log(`[4/4] Wrote ${MANHOUR_ENDPOINTS_OUT}`);

  // Print manhour-specific endpoints
  const manhourEndpoints = sorted.filter(p =>
    /manpower|confirm|week|actual/i.test(p) ||
    /pmpManpower|mpManpower/i.test(p)
  );
  console.log(`\n=== Manhour-specific endpoints (${manhourEndpoints.length}) ===`);
  for (const p of manhourEndpoints) console.log(`  ${p}`);

  // Print all endpoints for reference
  console.log(`\n=== All endpoints (${sorted.length}) ===`);
  for (const p of sorted) console.log(`  ${p}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
