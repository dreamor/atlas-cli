import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CACHE_DIR, PROJECTS_FILE } from '../util/paths.js';
import { ProjectSchema, type Project } from '../schema/models.js';
import type { BanmaClient } from '../http/client.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_AMBIGUOUS = 10;

interface CacheFile {
  readonly fetchedAt: string;
  readonly items: readonly Project[];
}

async function isFresh(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

async function readCache(path: string): Promise<readonly Project[] | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    return parsed.items ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  path: string,
  items: readonly Project[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  const payload: CacheFile = {
    fetchedAt: new Date().toISOString(),
    items,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
}

export async function loadProjectCatalog(
  client: BanmaClient,
  opts: { refresh?: boolean } = {},
): Promise<readonly Project[]> {
  if (!opts.refresh && (await isFresh(PROJECTS_FILE))) {
    const cached = await readCache(PROJECTS_FILE);
    if (cached) return cached;
  }
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/project/selectHasPermisValidProject.json',
    method: 'POST',
    body: {},
  });
  const arr = Array.isArray(data) ? data : [];
  const items = arr
    .map((row) => {
      const r = ProjectSchema.safeParse(row);
      return r.success ? r.data : null;
    })
    .filter((x): x is Project => x !== null);
  await writeCache(PROJECTS_FILE, items);
  return items;
}

export interface ResolvedProject {
  readonly id: string;
  readonly name: string;
}

export type ResolveResult =
  | { readonly kind: 'resolved'; readonly project: ResolvedProject }
  | { readonly kind: 'ambiguous'; readonly matches: readonly ResolvedProject[] }
  | { readonly kind: 'notFound' };

function toResolved(p: Project): ResolvedProject {
  return { id: String(p.id), name: p.name };
}

export function resolveProjectIdFromName(
  catalog: readonly Project[],
  query: string,
): ResolveResult {
  const trimmed = query.trim();
  if (!trimmed) return { kind: 'notFound' };

  // 1. Exact numeric id match
  if (/^[0-9]+$/.test(trimmed)) {
    const byId = catalog.find((p) => String(p.id) === trimmed);
    if (byId) return { kind: 'resolved', project: toResolved(byId) };
  }

  const lower = trimmed.toLowerCase();

  // 2. Exact case-insensitive name match
  const byExactName = catalog.find((p) => p.name.toLowerCase() === lower);
  if (byExactName) {
    return { kind: 'resolved', project: toResolved(byExactName) };
  }

  // 3. Case-insensitive substring match
  const subMatches = catalog.filter((p) =>
    p.name.toLowerCase().includes(lower),
  );
  if (subMatches.length === 0) return { kind: 'notFound' };
  if (subMatches.length === 1) {
    return { kind: 'resolved', project: toResolved(subMatches[0]!) };
  }
  return {
    kind: 'ambiguous',
    matches: subMatches.slice(0, MAX_AMBIGUOUS).map(toResolved),
  };
}
