/**
 * `atlas actual export` — export actual manpower data to CSV/JSON.
 *
 * Separated from the original export.ts which handled both baseline and actual.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getClientOrExit } from '../_client.js';
import { fetchManpowerConfirm } from '../_manhours.js';
import {
  flattenManpowerTree,
  filterActualRows,
  summarizeActual,
  type ActualFilter,
  type ActualStaffRow,
} from '../_actual_logic.js';
import { loadDepartments } from '../../dict/cache.js';
import { resolveDept } from '../../dict/resolve.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError, NotImplementedError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import { loadSession } from '../../auth/session.js';
import type { DepartmentResolver } from '../_month_logic.js';

export interface ActualExportCmdOpts {
  readonly projectId?: string;
  readonly format: 'csv' | 'json' | 'parquet';
  readonly out: string;
  readonly by?: string;
  readonly status?: string;
  readonly department?: string;
  readonly role?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
  readonly json?: boolean;
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

export async function exportCmd(opts: ActualExportCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const session = await loadSession();
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const projName: string | null = resolved.name ?? null;

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
      target: 'actual' as const,
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
// Helpers (from original export.ts)
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