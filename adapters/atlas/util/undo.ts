/**
 * Undo manifest store for reversible write operations.
 *
 * Layout: `$CACHE_DIR/atlas/undo/<token>.json`.
 *
 * Manifest schema:
 *   {
 *     token,           // <command>-<projectId>-<YYYYMMDDTHHMMSS>-<rand>
 *     command,         // 'fill' (currently the only producer)
 *     target,          // 'lineplan' | 'month'
 *     projectId,
 *     timestamp,       // ISO 8601
 *     before:  [<row>],   // server state captured at apply time
 *     after:   [<row>],   // payload sent to the server
 *     serverResponse,  // raw response from saveLine{Plans,PlanMonths}
 *     undoneAt?:       // set by `atlas undo <token>` on success
 *   }
 *
 * Only `fill` writes manifests today. `import` is full-sheet replace; we'd
 * need the original sheet to reverse it cleanly — out of scope for P2.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Resolved at call time so tests can override HOME after import. Production
 * paths.ts caches HOME for cache-file constants, but the undo store is
 * write-heavy and worth keeping testable.
 */
function undoDir(): string {
  return resolve(homedir(), '.cache', 'atlas', 'undo');
}

export type UndoCommand = 'fill';
export type UndoTarget = 'lineplan' | 'month';

export interface UndoManifest {
  readonly token: string;
  readonly command: UndoCommand;
  readonly target: UndoTarget;
  readonly projectId: string;
  readonly timestamp: string;
  readonly before: ReadonlyArray<Record<string, unknown>>;
  readonly after: ReadonlyArray<Record<string, unknown>>;
  readonly serverResponse?: unknown;
  readonly undoneAt?: string;
}

export interface ManifestSummary {
  readonly token: string;
  readonly command: UndoCommand;
  readonly target: UndoTarget;
  readonly projectId: string;
  readonly timestamp: string;
  readonly rowCount: number;
  readonly undone: boolean;
}

const TOKEN_RE = /^[a-zA-Z0-9._-]+$/;

export function newToken(command: UndoCommand, projectId: string): string {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${command}-${projectId}-${ts}-${rand}`;
}

export function manifestPath(token: string): string {
  validateToken(token);
  return join(undoDir(), `${token}.json`);
}

function validateToken(token: string): void {
  if (!TOKEN_RE.test(token)) {
    throw new Error(`Invalid undo token: ${token}`);
  }
}

export async function writeManifest(manifest: UndoManifest): Promise<string> {
  await mkdir(undoDir(), { recursive: true });
  const p = manifestPath(manifest.token);
  await writeFile(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

export async function loadManifest(token: string): Promise<UndoManifest> {
  const raw = await readFile(manifestPath(token), 'utf8');
  const parsed = JSON.parse(raw) as UndoManifest;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.token !== 'string' ||
    !Array.isArray(parsed.before) ||
    !Array.isArray(parsed.after)
  ) {
    throw new Error(`Manifest ${token} is malformed.`);
  }
  return parsed;
}

export async function markUndone(token: string): Promise<UndoManifest> {
  const m = await loadManifest(token);
  if (m.undoneAt) {
    throw new Error(`Manifest ${token} was already undone at ${m.undoneAt}.`);
  }
  const next: UndoManifest = { ...m, undoneAt: new Date().toISOString() };
  await writeFile(manifestPath(token), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function listManifests(limit = 30): Promise<ManifestSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(undoDir());
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith('.json'));
  const withTimes = await Promise.all(
    files.map(async (f) => {
      const p = join(undoDir(), f);
      try {
        const s = await stat(p);
        return { file: f, mtimeMs: s.mtimeMs };
      } catch {
        return { file: f, mtimeMs: 0 };
      }
    }),
  );
  withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const top = withTimes.slice(0, limit);
  const summaries: ManifestSummary[] = [];
  for (const { file } of top) {
    const token = file.replace(/\.json$/, '');
    try {
      const m = await loadManifest(token);
      summaries.push({
        token: m.token,
        command: m.command,
        target: m.target,
        projectId: m.projectId,
        timestamp: m.timestamp,
        rowCount: m.before.length,
        undone: m.undoneAt !== undefined,
      });
    } catch {
      // skip malformed manifests silently — agent shouldn't crash on stale junk
    }
  }
  return summaries;
}
