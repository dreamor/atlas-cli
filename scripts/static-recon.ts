#!/usr/bin/env -S node --import tsx
/**
 * Static recon: fetch the SPA's JS chunks using the persisted session and
 * grep for endpoint patterns. Zero-mutation.
 *
 * Usage:
 *   npx tsx scripts/static-recon.ts
 *
 * Output:
 *   .opencli/recon/static-endpoints.txt — sorted unique candidate endpoints
 *   .opencli/recon/static-jsfiles.txt   — list of JS chunks discovered
 */

import { request } from 'undici';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSession, buildCookieHeader } from '../adapters/atlas/auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../adapters/atlas/util/paths.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const RECON_DIR = resolve(REPO_ROOT, '.opencli/recon');
const ENDPOINTS_OUT = resolve(RECON_DIR, 'static-endpoints.txt');
const JSFILES_OUT = resolve(RECON_DIR, 'static-jsfiles.txt');

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
  const res = await request(url, { method: 'GET', headers });
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode} for ${url}`);
  return res.body.text();
}

function extractScriptUrls(html: string): string[] {
  const urls = new Set<string>();
  // <script src="..."> and modulepreload links
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
  // Vite chunk references: paths like "/assets/foo-abcd1234.js"
  const re = /["'](\/assets\/[A-Za-z0-9._/-]+\.js)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsText)) !== null) {
    if (m[1]) urls.add(`${BASE_URL}${m[1]}`);
  }
  return [...urls];
}

function extractEndpoints(jsText: string): string[] {
  const found = new Set<string>();
  // Match strings ending in .json under /yuntu-service/ or /banma-service/ etc.
  const reJson = /["'`](\/(?:yuntu|banma|api)[A-Za-z0-9_./-]*?\.json)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = reJson.exec(jsText)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  // Also match REST-style paths that don't end in .json
  const reRest = /["'`](\/(?:yuntu-service|banma-service)\/[A-Za-z0-9_./-]+?)["'`]/g;
  while ((m = reRest.exec(jsText)) !== null) {
    if (m[1] && !m[1].includes('${')) found.add(m[1]);
  }
  return [...found];
}

async function main(): Promise<void> {
  await mkdir(RECON_DIR, { recursive: true });
  await writeFile(ENDPOINTS_OUT, '');
  await writeFile(JSFILES_OUT, '');

  const headers = await buildHeaders();
  const indexUrl = `${BASE_URL}/projects/mpLine/list?projectId=2548`;

  console.log(`[1/4] Fetching index HTML...`);
  const html = await fetchText(indexUrl, headers);
  const initialScripts = extractScriptUrls(html);
  console.log(`     found ${initialScripts.length} initial <script src=...>`);

  // BFS: fetch initial scripts, extract more chunk references, fetch those too (one hop)
  const visited = new Set<string>();
  const queue = [...initialScripts];
  const allEndpoints = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && fetched < 200) {
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
      await appendFile(JSFILES_OUT, `${url}  size=${js.length}  chunks=${newChunks.length}  endpoints=${eps.length}\n`);
      if (fetched % 20 === 0) console.log(`     [${fetched}] visited, queue=${queue.length}, endpoints=${allEndpoints.size}`);
    } catch (err) {
      await appendFile(JSFILES_OUT, `${url}  ERROR ${(err as Error).message}\n`);
    }
  }

  console.log(`[2/4] Fetched ${fetched} JS files. Discovered ${allEndpoints.size} endpoint strings.`);

  // Categorize
  const sorted = [...allEndpoints].sort();
  const writeKeyword = /(insert|update|delete|save|create|edit|remove|modify|add|submit|import|batch)/i;
  const writes = sorted.filter((p) => writeKeyword.test(p));
  const reads = sorted.filter((p) => !writeKeyword.test(p));

  await writeFile(
    ENDPOINTS_OUT,
    [
      `# Static recon — all endpoints discovered in SPA bundles`,
      `# Total: ${sorted.length}    write-suspicious: ${writes.length}    other: ${reads.length}`,
      ``,
      `## Likely WRITE endpoints (insert/update/delete/save/create/etc.)`,
      ...writes.map((p) => `  ${p}`),
      ``,
      `## Other endpoints (likely reads / metadata)`,
      ...reads.map((p) => `  ${p}`),
      ``,
    ].join('\n'),
  );

  console.log(`[3/4] Wrote ${ENDPOINTS_OUT}`);
  console.log(`[4/4] Top write candidates:`);
  for (const p of writes.slice(0, 30)) console.log(`     ${p}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
