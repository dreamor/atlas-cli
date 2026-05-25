/**
 * `atlas resolve <kind> <query>` — agent-friendly name→id resolver.
 *
 * Unlike the project-id flag (which throws AMBIGUOUS_PROJECT on >1 match),
 * this command ALWAYS succeeds with a list of candidates. Agents call it
 * before any other command and pass the resulting id verbatim, eliminating
 * ambiguity from downstream calls.
 *
 * Supported kinds (all case-insensitive substring matching, except project
 * which prefers exact-then-fuzzy):
 *   - project
 *   - department
 *   - mp-type | line-plan-type | src-type  (dictionary lookups)
 *   - area-code                            (dictionary lookup)
 */

import { getClientOrExit } from './_client.js';
import { loadProjectCatalog, resolveProjectIdFromName } from '../dict/projectCatalog.js';
import { loadDepartments, loadDictionary } from '../dict/cache.js';
import { ConfigError } from '../util/errors.js';
import { printResult } from '../util/output.js';
import type { Department, Dictionary } from '../schema/models.js';

export type ResolveKind =
  | 'project'
  | 'department'
  | 'mp-type'
  | 'line-plan-type'
  | 'src-type'
  | 'area-code';

const VALID_KINDS: ReadonlySet<ResolveKind> = new Set([
  'project',
  'department',
  'mp-type',
  'line-plan-type',
  'src-type',
  'area-code',
]);

/** Dictionary `type` ids used by Banma. Verified empirically from the cache. */
const DICT_TYPE_BY_KIND: Record<Exclude<ResolveKind, 'project' | 'department'>, string> = {
  'mp-type': 'mpType',
  'line-plan-type': 'linePlanType',
  'src-type': 'srcType',
  'area-code': 'areaCode',
};

export interface ResolveCandidate {
  readonly id: string;
  readonly name: string;
  readonly extra?: Record<string, unknown>;
}

export interface ResolveCmdOpts {
  readonly json?: boolean;
  readonly refresh?: boolean;
  readonly limit?: string;
}

export async function resolveCmd(
  kind: string,
  query: string,
  opts: ResolveCmdOpts,
): Promise<void> {
  const k = parseKind(kind);
  const limit = parseLimit(opts.limit);
  const client = await getClientOrExit();

  const candidates =
    k === 'project'
      ? await resolveProjects(client, query, opts.refresh)
      : k === 'department'
        ? await resolveDepartments(client, query, opts.refresh)
        : await resolveDictionary(client, k, query, opts.refresh);

  const truncated = candidates.length > limit;
  const finalCandidates = candidates.slice(0, limit);

  printResult(
    {
      kind: k,
      query,
      count: candidates.length,
      truncated,
      candidates: finalCandidates,
    },
    {
      json: opts.json,
      hint: pickHint(finalCandidates.length, k),
      renderHuman: () => renderHuman(k, query, candidates.length, finalCandidates, truncated),
    },
  );
}

function parseKind(raw: string): ResolveKind {
  const v = raw as ResolveKind;
  if (!VALID_KINDS.has(v)) {
    throw new ConfigError(
      `<kind> must be one of: ${[...VALID_KINDS].join(', ')} (got "${raw}")`,
    );
  }
  return v;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`--limit must be a positive integer (got "${raw}")`);
  }
  return n;
}

async function resolveProjects(
  client: Awaited<ReturnType<typeof getClientOrExit>>,
  query: string,
  refresh: boolean | undefined,
): Promise<ResolveCandidate[]> {
  const catalog = await loadProjectCatalog(client, { refresh });
  const result = resolveProjectIdFromName(catalog, query);
  if (result.kind === 'resolved') {
    return [{ id: result.project.id, name: result.project.name }];
  }
  if (result.kind === 'ambiguous') {
    return result.matches.map((m) => ({ id: m.id, name: m.name }));
  }
  // notFound — still do a permissive substring sweep to give the agent
  // something to suggest rather than empty hands.
  const lower = query.trim().toLowerCase();
  return catalog
    .filter((p) => p.name.toLowerCase().includes(lower))
    .map((p) => ({ id: String(p.id), name: p.name }));
}

async function resolveDepartments(
  client: Awaited<ReturnType<typeof getClientOrExit>>,
  query: string,
  refresh: boolean | undefined,
): Promise<ResolveCandidate[]> {
  const depts = await loadDepartments(client, { refresh });
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  const matched: Array<{ readonly d: Department; readonly score: number }> = [];
  for (const d of depts) {
    const score = scoreDepartment(d, trimmed, lower);
    if (score > 0) matched.push({ d, score });
  }
  matched.sort((a, b) => b.score - a.score);
  return matched.map(({ d }) => ({
    id: String(d.id),
    name: d.deptName ?? '',
    extra: {
      deptCode: d.deptCode ?? null,
      buCode: d.buCode ?? null,
    },
  }));
}

function scoreDepartment(d: Department, raw: string, lower: string): number {
  // Numeric ids and codes beat substring; exact name beats substring.
  if (String(d.id) === raw) return 100;
  if (d.deptCode && String(d.deptCode) === raw) return 90;
  if (d.buCode && String(d.buCode) === raw) return 90;
  const name = (d.deptName ?? '').toLowerCase();
  if (name === lower) return 80;
  if (name.includes(lower)) return 10;
  return 0;
}

async function resolveDictionary(
  client: Awaited<ReturnType<typeof getClientOrExit>>,
  kind: Exclude<ResolveKind, 'project' | 'department'>,
  query: string,
  refresh: boolean | undefined,
): Promise<ResolveCandidate[]> {
  const dict = await loadDictionary(client, { refresh });
  const dictType = DICT_TYPE_BY_KIND[kind];
  const raw = query.trim();
  const lower = raw.toLowerCase();
  const out: ResolveCandidate[] = [];
  for (const row of dict) {
    if (String(row.type) !== dictType) continue;
    if (!matchesDictRow(row, raw, lower)) continue;
    out.push({
      id: String(row.attrValue ?? ''),
      name: row.attrName ?? '',
    });
  }
  return out;
}

function matchesDictRow(row: Dictionary, raw: string, lower: string): boolean {
  if (raw === '') return true; // empty query → all candidates
  const id = String(row.attrValue ?? '');
  if (id === raw) return true;
  const name = (row.attrName ?? '').toLowerCase();
  return name === lower || name.includes(lower);
}

function pickHint(count: number, kind: ResolveKind): string {
  if (count === 0) return `No ${kind} matches. Try a shorter query or --refresh.`;
  if (count === 1) return `Single match — safe to pass as id to downstream commands.`;
  return `Multiple matches — confirm with the user which id to use.`;
}

function renderHuman(
  kind: ResolveKind,
  query: string,
  total: number,
  candidates: readonly ResolveCandidate[],
  truncated: boolean,
): void {
  /* eslint-disable no-console */
  console.log(`Resolved ${candidates.length}/${total} candidate(s) for ${kind} "${query}":`);
  for (const c of candidates) {
    console.log(`  ${c.id.padEnd(10)} ${c.name}`);
  }
  if (truncated) console.log(`  ... (truncated; pass --limit to widen)`);
  /* eslint-enable no-console */
}
