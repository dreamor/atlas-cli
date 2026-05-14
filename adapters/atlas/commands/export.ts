import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getClientOrExit } from './_client.js';
import { fetchLinePlans } from './_lineplans.js';
import { resolveProjectIdAsync } from '../util/projectId.js';
import { NotImplementedError } from '../util/errors.js';
import type { LinePlan } from '../schema/models.js';

export interface ExportCmdOpts {
  readonly projectId?: string;
  readonly format: 'csv' | 'json' | 'parquet';
  readonly out: string;
  readonly since?: string;
  readonly refreshProjects?: boolean;
}

export async function exportCmd(opts: ExportCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const { items } = await fetchLinePlans(client, { projectId });

  const sinceMs = opts.since ? Date.parse(opts.since) : undefined;
  const filtered =
    sinceMs && !Number.isNaN(sinceMs)
      ? items.filter((it) => {
          const t = parseTime(it.gmtModified ?? it.gmtCreate);
          return t === null || t >= sinceMs;
        })
      : items;

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
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${filtered.length} item(s) to ${opts.out} (${opts.format})${
      resolved.name ? ` from project "${resolved.name}" (${projectId})` : ''
    }.`,
  );
}

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

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
