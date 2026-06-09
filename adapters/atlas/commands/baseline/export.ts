/**
 * `atlas baseline export` — export baseline (计划) data to CSV/JSON.
 *
 * Separated from the original export.ts which handled both baseline and actual.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getClientOrExit } from '../_client.js';
import { fetchLinePlans } from '../_lineplans.js';
import { loadDepartments } from '../../dict/cache.js';
import { resolveDept } from '../../dict/resolve.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError, NotImplementedError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import type { LinePlan } from '../../schema/models.js';

const includesCi = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

export interface BaselineExportCmdOpts {
  readonly projectId?: string;
  readonly format: 'csv' | 'json' | 'parquet';
  readonly out: string;
  readonly since?: string;
  readonly department?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
  readonly json?: boolean;
}

export async function exportCmd(opts: BaselineExportCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const projName: string | null = resolved.name ?? null;

  const { items } = await fetchLinePlans(client as any, { projectId });
  const depts = opts.department ? await loadDepartments(client) : [];

  const sinceMs = opts.since ? Date.parse(opts.since) : undefined;
  let filtered = sinceMs && !Number.isNaN(sinceMs)
    ? items.filter((it) => {
        const t = parseTime(it.gmtModified ?? it.gmtCreate);
        return t === null || t >= sinceMs;
      })
    : items;

  // Apply --department filter
  if (opts.department) {
    filtered = filtered.filter((it) => {
      const deptName = resolveDept(depts ?? [], it.departmentId ?? null) ?? '';
      const blob = `${deptName} ${it.departmentId ?? ''}`;
      return includesCi(blob, opts.department!);
    });
  }

  await mkdir(dirname(opts.out), { recursive: true });

  if (opts.format === 'json') {
    await writeFile(opts.out, JSON.stringify(filtered, null, 2), 'utf8');
  } else if (opts.format === 'csv') {
    await writeFile(opts.out, toCsv(filtered), 'utf8');
  } else {
    throw new NotImplementedError(
      'parquet export not implemented in spike. Use --format csv or --format json.',
    );
  }

  printResult(
    {
      projectId,
      projectName: projName ?? null,
      out: opts.out,
      format: opts.format,
      target: 'baseline' as const,
      count: filtered.length,
    },
    {
      json: opts.json,
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(
          `Wrote ${filtered.length} baseline item(s) to ${opts.out} (${opts.format})${
            projName ? ` from project "${projName}" (${projectId})` : ''
          }.`,
        );
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers (from original export.ts)
// ---------------------------------------------------------------------------

function parseTime(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 1e9) return n;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

function toCsv(items: readonly LinePlan[]): string {
  if (items.length === 0) return '';
  const keys = collectKeys(items);
  const head = keys.map(csvEscape).join(',');
  const rows = items.map((it) =>
    keys
      .map((k) => csvEscape(stringifyCell((it as Record<string, unknown>)[k])))
      .join(','),
  );
  return [head, ...rows].join('\n') + '\n';
}

function collectKeys(items: readonly LinePlan[]): string[] {
  const set = new Set<string>();
  for (const it of items) for (const k of Object.keys(it)) set.add(k);
  return [...set];
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}