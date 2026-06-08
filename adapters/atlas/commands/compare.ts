/**
 * `atlas compare` — compare baseline (计划) vs actual (实际) manpower.
 *
 * Fetches both baseline (line/plan/month) and actual (manpower confirm) data
 * in parallel, then produces a side-by-side comparison grouped by the
 * chosen axis (month / department / role).
 *
 * Data sources:
 *   - Baseline: /yuntu-service/line/plan/month/select.json
 *   - Actual:   /yuntu-service/yida/manpower/getProjMpConfirmDetail.json
 */
import { getClientOrExit } from './_client.js';
import { fetchLinePlanMonths } from './_lineplans.js';
import { fetchManpowerConfirm, type ConfirmStatus } from './_manhours.js';
import { loadDepartments } from '../dict/cache.js';
import { resolveDept } from '../dict/resolve.js';
import { resolveProjectIdAsync } from '../util/projectId.js';
import { ConfigError } from '../util/errors.js';
import { printResult } from '../util/output.js';
import { loadSession } from '../auth/session.js';
import {
  applyRowFilter,
  summarizeMonths,
  type DepartmentResolver,
  type SummaryAxis,
  type SummaryEntry,
} from './_month_logic.js';
import {
  flattenManpowerTree,
  filterActualRows,
  summarizeActual,
  type ActualFilter,
  type ActualStatusFilter,
  type ActualStaffRow,
  type ActualSummaryEntry,
} from './_actual_logic.js';
import {
  buildCompareResult,
  renderCompareTable,
  paginateCompareEntries,
  type CompareAxis,
  type CompareOptions,
  type CompareResult,
  type ComparePage,
} from './_compare_logic.js';

export interface CompareCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly by?: string;
  readonly month?: string;
  readonly from?: string;
  readonly to?: string;
  readonly department?: string;
  readonly role?: string;
  readonly status?: string; // 'pending' | 'approved' | 'all'
  readonly threshold?: number;
  readonly flagOverrun?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  readonly refreshProjects?: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const VALID_AXES: ReadonlySet<CompareAxis> = new Set(['month', 'department', 'role']);

function validateMonth(label: string, val: string | undefined): void {
  if (val === undefined) return;
  if (!MONTH_RE.test(val)) {
    throw new ConfigError(`${label} must be YYYY-MM (got "${val}")`);
  }
}

function parseAxis(raw: string | undefined): CompareAxis {
  const v = (raw ?? 'month') as CompareAxis;
  if (!VALID_AXES.has(v)) {
    throw new ConfigError(`--by must be one of month|department|role (got "${raw}")`);
  }
  return v;
}

function parseStatusFilter(raw: string | undefined): ActualStatusFilter {
  if (!raw || raw === 'all') return 'all';
  const lower = raw.toLowerCase();
  if (lower === 'pending' || lower === '0') return 'pending';
  if (lower === 'approved' || lower === '1') return 'approved';
  throw new ConfigError(
    `--status must be pending|approved|all (got "${raw}")`,
  );
}

function buildActualFilter(opts: CompareCmdOpts): ActualFilter {
  return {
    department: opts.department,
    role: opts.role,
    staffName: undefined,
    status: parseStatusFilter(opts.status),
  };
}

function buildCompareOpts(opts: CompareCmdOpts): CompareOptions {
  return {
    axis: parseAxis(opts.by),
    from: opts.from,
    to: opts.to,
    department: opts.department,
    role: opts.role,
    status: parseStatusFilter(opts.status),
    threshold: opts.threshold ?? 0,
    flagOverrun: opts.flagOverrun ?? false,
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 0,
  };
}

export async function compareCmd(opts: CompareCmdOpts): Promise<void> {
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  const client = await getClientOrExit();
  const session = await loadSession();
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  // Determine the month to query for actual data.
  // For compare, we use the month(s) in the filter range.
  // If a single --month is given, use that; otherwise fall back to current month
  // for the API call (the actual endpoint requires a month param).
  const monthParam = opts.month ?? opts.from ?? opts.to ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  // Parallel fetch: baseline (plan) + actual (pending & approved)
  const [baselineResult, pendingResult, approvedResult, depts] = await Promise.all([
    fetchLinePlanMonths(client, { projectId }),
    fetchManpowerConfirm(client, {
      projectId,
      month: monthParam,
      staffId: session.empId,
      status: 0, // pending
    }),
    fetchManpowerConfirm(client, {
      projectId,
      month: monthParam,
      staffId: session.empId,
      status: 1, // approved
    }),
    loadDepartments(client),
  ]);

  const resolveDepartment: DepartmentResolver = (id) =>
    resolveDept(depts, (id ?? null) as string | number | null) ?? '';

  // --- Baseline pipeline ---
  const filteredBaseline = applyRowFilter(
    baselineResult.items,
    { department: opts.department, role: opts.role },
    resolveDepartment,
  );
  const baselineSummary = summarizeMonths(filteredBaseline, {
    by: parseAxis(opts.by),
    filter: { from: opts.from, to: opts.to },
    resolveDepartment,
  });

  // --- Actual pipeline ---
  const pendingRows = flattenManpowerTree(
    pendingResult.teamMp ?? [],
    '',
    '',
    0,
  );
  const approvedRows = flattenManpowerTree(
    approvedResult.teamMp ?? [],
    '',
    '',
    1,
  );

  // Merge: approved overwrites pending per staffId
  const staffMap = new Map<string, ActualStaffRow>();
  for (const row of pendingRows) {
    staffMap.set(row.staffId, row);
  }
  for (const row of approvedRows) {
    staffMap.set(row.staffId, row);
  }
  const allRows = [...staffMap.values()];

  const actualFilter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: undefined,
    status: parseStatusFilter(opts.status),
  };
  const filteredActual = filterActualRows(allRows, actualFilter);

  const actualSummary = summarizeActual(filteredActual, parseAxis(opts.by), {
    from: opts.from,
    to: opts.to,
  });

  // --- Build comparison ---
  const compareOpts = buildCompareOpts(opts);
  const result = buildCompareResult(baselineSummary, actualSummary, compareOpts);

  // --- Compute summary stats for baseline & actual ---
  // Use parsedMonth from monthParam for meta display
  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  // --- Pagination ---
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 0;
  const paginated =
    pageSize > 0
      ? paginateCompareEntries(result.entries, page, pageSize)
      : null;

  const displayEntries = paginated?.entries ?? result.entries;
  const pageMeta = paginated
    ? {
        page: paginated.page,
        pageSize: paginated.pageSize,
        totalPages: paginated.totalPages,
        totalEntries: paginated.total,
      }
    : undefined;

  // Map SummaryEntry[] to expected output format
  // and ActualSummaryEntry[] similarly.
  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      by: result.axis,
      entries: displayEntries,
      baselineTotal: result.baselineTotal,
      actualTotal: result.actualTotal,
      grandDiff: result.grandDiff,
      grandDiffPercent: result.grandDiffPercent,
      month: monthParam,
      filter: {
        from: opts.from ?? null,
        to: opts.to ?? null,
        department: opts.department ?? null,
        role: opts.role ?? null,
        status: parseStatusFilter(opts.status),
        threshold: opts.threshold ?? 0,
        flagOverrun: opts.flagOverrun ?? false,
      },
      ...(pageMeta ? { page: pageMeta } : {}),
    },
    {
      json: opts.json,
      meta: {
        rows: displayEntries.length,
        baselineTotal: result.baselineTotal,
        actualTotal: result.actualTotal,
        grandDiff: result.grandDiff,
        grandDiffPercent: result.grandDiffPercent,
        ...(pageMeta ? { pagination: pageMeta } : {}),
      },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderCompareTable(result.axis, displayEntries, {
          baselineTotal: result.baselineTotal,
          actualTotal: result.actualTotal,
          grandDiff: result.grandDiff,
          grandDiffPercent: result.grandDiffPercent,
        }));
        // eslint-disable-next-line no-console
        console.log(
          `\n${displayEntries.length} bucket(s) by ${result.axis} in ${projLabel}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `Baseline total: ${result.baselineTotal}h | Actual total: ${result.actualTotal}h | Diff: ${result.grandDiff > 0 ? '+' : ''}${result.grandDiff}h (${result.grandDiffPercent > 0 ? '+' : ''}${result.grandDiffPercent.toFixed(1)}%)`,
        );
        if (pageMeta && pageMeta.totalPages > 1) {
          // eslint-disable-next-line no-console
          console.log(
            `Page ${pageMeta.page}/${pageMeta.totalPages} (${pageMeta.pageSize} items per page, ${pageMeta.totalEntries} total)`,
          );
        }
      },
    },
  );
}