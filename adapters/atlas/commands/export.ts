import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getClientOrExit } from './_client.js';
import { fetchLinePlans } from './_lineplans.js';
import { fetchManpowerConfirm } from './_manhours.js';
import {
  flattenManpowerTree,
  filterActualRows,
  summarizeActual,
  type ActualFilter,
  type ActualStaffRow,
} from './_actual_logic.js';
import {
  applyRowFilter,
  summarizeMonths,
  type DepartmentResolver,
} from './_month_logic.js';
import { resolveProjectIdAsync } from '../util/projectId.js';
import { loadDepartments } from '../dict/cache.js';
import { resolveDept } from '../dict/resolve.js';
import { ConfigError, NotImplementedError } from '../util/errors.js';
import { printResult } from '../util/output.js';
import { loadSession } from '../auth/session.js';
import type { SummaryEntry } from './_month_logic.js';
import type { ActualSummaryEntry } from './_actual_logic.js';
import type { LinePlan } from '../schema/models.js';

export type ExportTarget = 'baseline' | 'actual';

export interface ExportCmdOpts {
  readonly projectId?: string;
  readonly format: 'csv' | 'json' | 'parquet';
  readonly out: string;
  readonly since?: string;
  readonly target?: ExportTarget;
  readonly by?: string;
  readonly status?: string;
  readonly department?: string;
  readonly role?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
  readonly json?: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateMonth(label: string, val: string | undefined): void {
  if (val === undefined) return;
  if (!MONTH_RE.test(val)) {
    throw new ConfigError(`${label} must be YYYY-MM (got "${val}")`);
  }
}

function parseStatusFilter(raw: string | undefined): ActualFilter['status'] {
  if (!raw || raw === 'all') return 'all';
  const lower = raw.toLowerCase();
  if (lower === 'pending' || lower === '0') return 'pending';
  if (lower === 'approved' || lower === '1') return 'approved';
  throw new ConfigError(
    `--status must be pending|approved|all (got "${raw}")`,
  );
}

export async function exportCmd(opts: ExportCmdOpts): Promise<void> {
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  const target = opts.target ?? 'baseline';

  const projName: string | null = resolved.name ?? null;

  if (target === 'actual') {
    return await exportActual(client, projName, projectId, opts);
  }
  return await exportBaseline(client, projName, projectId, opts);
}

// ---------------------------------------------------------------------------
// Baseline export
// ---------------------------------------------------------------------------

async function exportBaseline(
  client: { request<T>(opts: unknown): Promise<{ data: T }> },
  projName: string | null,
  projectId: string,
  opts: ExportCmdOpts,
): Promise<void> {
  const { items } = await fetchLinePlans(client as any, { projectId });

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

  printResult(
    {
      projectId,
      projectName: projName ?? null,
      out: opts.out,
      format: opts.format,
      target: 'baseline' as ExportTarget,
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
// Actual export
// ---------------------------------------------------------------------------

async function exportActual(
  client: { request<T>(opts: unknown): Promise<{ data: T }> },
  projName: string | null,
  projectId: string,
  opts: ExportCmdOpts,
): Promise<void> {
  const session = await loadSession();
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const monthParam = opts.from ?? opts.to ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  const actualFilter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: undefined,
    status: parseStatusFilter(opts.status),
  };

  // Fetch both pending and approved in parallel
  const [pendingResult, approvedResult, depts] = await Promise.all([
    fetchManpowerConfirm(client as any, {
      projectId,
      month: monthParam,
      staffId: session.empId,
      status: 0,
    }),
    fetchManpowerConfirm(client as any, {
      projectId,
      month: monthParam,
      staffId: session.empId,
      status: 1,
    }),
    loadDepartments(client as any),
  ]);

  const pendingRows = flattenManpowerTree(pendingResult.teamMp ?? [], '', '', 0);
  const approvedRows = flattenManpowerTree(approvedResult.teamMp ?? [], '', '', 1);

  // Merge: approved overwrites pending per staffId
  const staffMap = new Map<string, ActualStaffRow>();
  for (const row of pendingRows) staffMap.set(row.staffId, row);
  for (const row of approvedRows) staffMap.set(row.staffId, row);
  const allRows = [...staffMap.values()];

  const filtered = filterActualRows(allRows, actualFilter);

  const resolveDepartment: DepartmentResolver = (id) =>
    resolveDept(depts, (id ?? null) as string | number | null) ?? '';

  const axis = opts.by ?? 'month';
  const summaryData = summarizeActual(filtered, axis as any, {
    from: opts.from,
    to: opts.to,
  });

  await mkdir(dirname(opts.out), { recursive: true });

  if (opts.format === 'json') {
    await writeFile(opts.out, JSON.stringify(summaryData, null, 2), 'utf8');
  } else if (opts.format === 'csv') {
    const rows = summaryData.map((e: any) => ({
      key: e.key,
      label: e.label,
      total: e.total,
    }));
    await writeFile(opts.out, jsonToCsv(rows), 'utf8');
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
      target: 'actual' as ExportTarget,
      by: axis,
      count: summaryData.length,
    },
    {
      json: opts.json,
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(
          `Wrote ${summaryData.length} actual summary item(s) by ${axis} to ${opts.out} (${opts.format})${
            projName ? ` from project "${projName}" (${projectId})` : ''
          }.`,
        );
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonToCsv(items: readonly Record<string, unknown>[]): string {
  if (items.length === 0) return '';
  const first = items[0]!;
  const keys = Object.keys(first);
  const head = keys.map(csvEscape).join(',');
  const rows = items.map((it) =>
    keys.map((k) => csvEscape(stringifyCell(it[k]))).join(','),
  );
  return [head, ...rows].join('\n') + '\n';
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