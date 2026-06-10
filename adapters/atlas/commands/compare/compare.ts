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
import { getClientOrExit } from '../_client.js';
import { fetchLinePlanMonths } from '../_lineplans.js';
import { fetchWeeklySummary } from '../_manhours.js';
import { loadDepartments } from '../../dict/cache.js';
import { resolveDept } from '../../dict/resolve.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import { loadSession } from '../../auth/session.js';
import {
  applyRowFilter,
  summarizeMonths,
  type DepartmentResolver,
  type SummaryAxis,
} from '../_month_logic.js';
import {
  flattenWeeklySummary,
  filterActualRows,
  filterActualByBusinessRule,
  summarizeActual,
  type ActualFilter,
  type ActualStatusFilter,
  type ActualStaffRow,
  type ActualSummaryEntry,
} from '../_actual_logic.js';
import {
  buildCompareResult,
  compareBaselines,
  baselineLabelMap,
  actualLabelMap,
  assignCompareLabels,
  computeCompareTotals,
  renderCompareTable,
  paginateCompareEntries,
  type CompareAxis,
  type CompareOptions,
  type CompareResult,
  type ComparePage,
  type CompareEntry,
} from '../_compare_logic.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand '2025-01'..'2026-06' to an array of all months in between.
 *  `offset` shifts the range forward/backward in months (e.g. actual API
 *   has a 1-month offset: query month=N to get data key=N-1).
 *  Caps at 36 months to avoid runaway API calls. */
function expandMonthRange(
  from: string | undefined, to: string | undefined,
  offset: number = 0,
): string[] {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!from && !to) return [nowStr];

  const f = from ?? nowStr;
  const t = to ?? nowStr;

  const [fy, fm] = f.split('-').map(Number);
  const [ty, tm] = t.split('-').map(Number);

  const months: string[] = [];
  let y = fy!, m = fm!;
  let maxIter = 36;
  while (maxIter-- > 0 && (y < ty! || (y === ty! && m <= tm!))) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  // 应用偏移
  if (offset !== 0) {
    return months.map((m) => {
      const [yy, mm] = m.split('-').map(Number);
      let ny = yy!, nm = mm! + offset;
      while (nm > 12) { nm -= 12; ny++; }
      while (nm < 1) { nm += 12; ny--; }
      return `${ny}-${String(nm).padStart(2, '0')}`;
    });
  }
  return months;
}

/**
 * Fetch actual data for a single month via the new API.
 * Returns flattened staff rows in 人月 (no /22 needed).
 */
async function fetchActualMonth(
  client: any,
  projectId: string,
  session: { empId: string },
  month: string,
): Promise<{ staffRows: ActualStaffRow[] }> {
  const result = await fetchWeeklySummary(client, {
    month,
    staffId: session.empId,
  });
  const rows = flattenWeeklySummary(result.data ?? []);
  return { staffRows: [...rows] };
}

export interface CompareCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly by?: string;
  readonly month?: string;
  readonly from?: string;
  readonly to?: string;
  readonly department?: string;
  readonly role?: string;
  readonly status?: string;
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

  // 确定实际数据需要查询的月份列表（与基线相同的范围）。
  // epochMsToMonthKey CST 修复后，API 返回的数据月份正确对齐。
  const actualMonths = expandMonthRange(opts.from, opts.to);
  const displayMonths = opts.month ?? `${actualMonths[0] ?? ''}..${actualMonths[actualMonths.length - 1] ?? ''}`;

  const [baselineResult, depts] = await Promise.all([
    fetchLinePlanMonths(client, { projectId }),
    loadDepartments(client),
  ]);

  // 串行查询实际数据（避免并发过多触发 API 限流）
  const actualMonthlyResults: Awaited<ReturnType<typeof fetchActualMonth>>[] = [];
  for (const m of actualMonths) {
    const result = await fetchActualMonth(client, projectId, session, m);
    actualMonthlyResults.push(result);
  }

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
  const axis = parseAxis(opts.by);
  const hasExplicitStatus = opts.status !== undefined && opts.status !== '';
  const mergedMap = new Map<string, ActualStaffRow>();

  for (const result of actualMonthlyResults) {
    for (const row of result.staffRows) mergedMap.set(row.staffId, row);
  }

  let allActualRows = [...mergedMap.values()];

  // Apply business-rule filter by default; explicit --status skips it
  if (!hasExplicitStatus) {
    allActualRows = [...filterActualByBusinessRule(allActualRows)];
  }

  const actualFilter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: undefined,
    status: parseStatusFilter(opts.status),
  };
  const filteredActual = filterActualRows(allActualRows, actualFilter);

  // Both month and dept/role axes use summarizeActual (already in 人月)
  let result: CompareResult;

  const actualSummary = summarizeActual(filteredActual, axis, {});
  result = buildCompareResult(baselineSummary, actualSummary, {
    axis,
    threshold: opts.threshold ?? 0,
    flagOverrun: opts.flagOverrun ?? false,
  });

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
      month: displayMonths,
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
        const cmpUnit = result.axis === 'month' ? '个月' : result.axis === 'department' ? '个部门' : '种角色';
        console.log(
          `\n共 ${displayEntries.length} ${cmpUnit}（按${result.axis === 'month' ? '月份' : result.axis === 'department' ? '部门' : '角色'}对比）— ${projLabel}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `基线: ${result.baselineTotal} 人月 | 实际: ${result.actualTotal.toFixed(2)} 人月 | 差异: ${result.grandDiff > 0 ? '+' : ''}${result.grandDiff.toFixed(2)} 人月 (${result.grandDiffPercent > 0 ? '+' : ''}${result.grandDiffPercent.toFixed(1)}%)`,
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