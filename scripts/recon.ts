#!/usr/bin/env -S node --import tsx
/**
 * Recon script for Banma mpLine.
 *
 * Step 1 (read-only): launch Playwright with a persistent user-data-dir,
 * halt for manual SSO+2FA, then start HAR capture and let the user navigate
 * the list / detail / create / update / delete views. Captures every XHR.
 *
 * IMPORTANT: this script never mutates server state. It is read-only.
 * The user is responsible for clicking around. We only RECORD.
 *
 * Usage:
 *   npm run recon -- --project-id 2548
 *
 * Output:
 *   .opencli/recon/network.har        — full HAR
 *   .opencli/recon/xhr-log.jsonl      — one XHR per line (request+response meta)
 *   .opencli/recon/routes.jsonl       — page navigations
 *   .opencli/recon/trace.zip          — Playwright trace
 *   .playwright/user-data/            — persistent profile (cookies/localStorage)
 *
 * Pause instructions are printed to stdout. The script holds the browser open
 * until the user presses Ctrl+C.
 */

import { chromium, type BrowserContext, type Request, type Response } from 'playwright';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const USER_DATA_DIR = resolve(REPO_ROOT, '.playwright/user-data');
const RECON_DIR = resolve(REPO_ROOT, '.opencli/recon');
const HAR_PATH = resolve(RECON_DIR, 'network.har');
const XHR_LOG = resolve(RECON_DIR, 'xhr-log.jsonl');
const ROUTE_LOG = resolve(RECON_DIR, 'routes.jsonl');
const TRACE_PATH = resolve(RECON_DIR, 'trace.zip');

const TARGET_HOST = 'banma-yuntu.alibaba-inc.com';

function parseProjectId(): string {
  const argv = process.argv.slice(2);
  const ix = argv.indexOf('--project-id');
  if (ix >= 0 && argv[ix + 1]) return argv[ix + 1]!;
  const env = process.env.BANMA_PROJECT_ID;
  if (env) return env;
  console.error('ERROR: --project-id <id> required (or BANMA_PROJECT_ID env).');
  process.exit(2);
}

async function ensureDirs(): Promise<void> {
  await mkdir(USER_DATA_DIR, { recursive: true });
  await mkdir(RECON_DIR, { recursive: true });
}

function isInteresting(url: string): boolean {
  if (!url.includes(TARGET_HOST)) return false;
  // skip static asset noise
  if (/\.(?:js|css|png|jpe?g|svg|woff2?|ico|map)(?:\?|$)/i.test(url)) return false;
  return true;
}

async function logRequest(req: Request): Promise<void> {
  if (!isInteresting(req.url())) return;
  const entry = {
    ts: new Date().toISOString(),
    phase: 'request',
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
    headers: await safeHeaders(req),
    postData: req.postData()?.slice(0, 4096) ?? null,
  };
  await appendFile(XHR_LOG, JSON.stringify(entry) + '\n');
}

async function logResponse(res: Response): Promise<void> {
  const req = res.request();
  if (!isInteresting(req.url())) return;
  let bodyPreview: string | null = null;
  try {
    const buf = await res.body();
    bodyPreview = buf.toString('utf8').slice(0, 8192);
  } catch {
    // some responses (redirects, websocket upgrades) have no body
  }
  const entry = {
    ts: new Date().toISOString(),
    phase: 'response',
    method: req.method(),
    url: req.url(),
    status: res.status(),
    headers: res.headers(),
    bodyPreview,
  };
  await appendFile(XHR_LOG, JSON.stringify(entry) + '\n');
}

async function safeHeaders(req: Request): Promise<Record<string, string>> {
  try {
    return await req.allHeaders();
  } catch {
    return req.headers();
  }
}

function printSsoInstructions(targetUrl: string): void {
  const banner = `
================================================================================
  STEP 1 RECON — MANUAL SSO REQUIRED
================================================================================
  A Chromium window is now open at:
    ${targetUrl}

  ACTION REQUIRED (human, in the open browser):
    1) Complete Alibaba BUC SSO (username + password).
    2) Approve 2FA prompt on your phone / hardware key.
    3) Wait until the mpLine list page renders fully.
    4) Then exercise these flows ONE AT A TIME, slowly:
         a) Open the list view (already loaded).
         b) Apply a filter (status / assignee), change pagination, sort.
         c) Click into a single item — capture the detail view.
         d) Open (but DO NOT submit) a "create" dialog.
         e) Open (but DO NOT submit) an "edit" dialog on an item.
         f) Hover (DO NOT click) the delete affordance.
         g) Visit any "import" / "bulk" surface if present.
         h) Open the project settings / field-schema view if present.
       NEVER click final "Save" / "Submit" / "Confirm Delete" buttons.

  All XHRs are being recorded to:
    .opencli/recon/network.har
    .opencli/recon/xhr-log.jsonl
    .opencli/recon/trace.zip

  When done, return to this terminal and press Ctrl+C to close cleanly.
  Cookies / localStorage will persist in .playwright/user-data/ so future
  runs reuse the SSO session (no re-login until BUC expires it).
================================================================================
`;
  console.log(banner);
}

async function main(): Promise<void> {
  const projectId = parseProjectId();
  await ensureDirs();
  await writeFile(XHR_LOG, ''); // truncate
  await writeFile(ROUTE_LOG, '');

  const targetUrl = `https://${TARGET_HOST}/projects/mpLine/list?projectId=${projectId}`;
  const isFirstRun = !existsSync(resolve(USER_DATA_DIR, 'Default'));

  const context: BrowserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    recordHar: { path: HAR_PATH, mode: 'full', content: 'embed' },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  context.on('request', (req) => {
    void logRequest(req);
  });
  context.on('response', (res) => {
    void logResponse(res);
  });
  context.on('page', (page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const entry = { ts: new Date().toISOString(), url: frame.url() };
        void appendFile(ROUTE_LOG, JSON.stringify(entry) + '\n');
      }
    });
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  printSsoInstructions(targetUrl);
  if (isFirstRun) {
    console.log('  (First run detected — this is the manual SSO+2FA pass.)\n');
  } else {
    console.log('  (Reusing persisted profile — SSO may already be valid.)\n');
  }

  // Hold the process open until Ctrl+C
  await new Promise<void>((resolvePromise) => {
    const shutdown = async (): Promise<void> => {
      console.log('\n[recon] Stopping… saving trace + HAR.');
      try {
        await context.tracing.stop({ path: TRACE_PATH });
      } catch (err) {
        console.error('[recon] tracing.stop failed:', err);
      }
      try {
        await context.close();
      } catch (err) {
        console.error('[recon] context.close failed:', err);
      }
      console.log(`[recon] Artifacts:\n  HAR:    ${HAR_PATH}\n  XHRs:   ${XHR_LOG}\n  Routes: ${ROUTE_LOG}\n  Trace:  ${TRACE_PATH}`);
      resolvePromise();
    };
    process.on('SIGINT', () => {
      void shutdown();
    });
    process.on('SIGTERM', () => {
      void shutdown();
    });
  });
}

main().catch((err) => {
  console.error('[recon] FATAL:', err);
  process.exit(1);
});
