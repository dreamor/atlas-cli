/**
 * `atlas actual month` — 按月/范围查看各人员实际人力投入
 *
 * 展示每个人员在指定月份/月份范围内的实际工时数据。无参数时默认查
 * 当前自然年，行为对齐 `atlas baseline month`。
 *
 * 使用新 API（summaryByTeam）获取数据，已是人月，无需 /22 转换。
 * 默认按业务规则过滤：过去月份只显示已确认，当前月份显示所有已填数据。
 */
import { getClientOrExit } from '../_client.js';
import { fetchWeeklySummary } from '../_manhours.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import {
  flattenWeeklySummary,
  filterActualRows,
  filterActualByBusinessRule,
  pivotActualRows,
  renderActualPivotTable,
  type ActualFilter,
  type ActualStatusFilter,
} from '../_actual_logic.js';
import { loadSession } from '../../auth/session.js';

export interface ActualMonthCmdOpts {
  readonly projectId?: string;
  readonly month?: string;
  readonly from?: string;
  readonly to?: string;
  readonly status?: string;
  readonly department?: string;
  readonly role?: string;
  readonly staffName?: string;
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

function parseStatusFilter(raw: string | undefined): ActualStatusFilter {
  if (!raw || raw === 'all') return 'all';
  const lower = raw.toLowerCase();
  if (lower === 'pending' || lower === '0') return 'pending';
  if (lower === 'approved' || lower === '1') return 'approved';
  throw new ConfigError(
    `--status must be pending|approved|all (got "${raw}")`,
  );
}

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Generate YYYY-MM strings for all months in [from, to] inclusive. */
function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const months: string[] = [];
  let y = fy!, m = fm!;
  while (y < ty! || (y === ty && m <= tm!)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

export async function monthCmd(opts: ActualMonthCmdOpts): Promise<void> {
  validateMonth('--month', opts.month);
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  const statusFilter = parseStatusFilter(opts.status);
  const hasExplicitStatus = opts.status !== undefined && opts.status !== '';

  const client = await getClientOrExit();
  const session = await loadSession();
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  // Determine months to fetch
  let months: string[];
  if (opts.month) {
    months = [opts.month];
  } else if (opts.from && opts.to) {
    months = monthRange(opts.from, opts.to);
  } else if (opts.from) {
    months = monthRange(opts.from, getCurrentMonth());
  } else {
    // Default: current year
    const year = new Date().getFullYear().toString();
    months = monthRange(`${year}-01`, `${year}-12`);
  }

  // Fetch each month via new API (single call per month, no status split)
  const results: Array<{ month: string; rows: ReturnType<typeof flattenWeeklySummary> }> = [];
  for (const m of months) {
    try {
      const result = await fetchWeeklySummary(client, {
        month: m,
        staffId: session.empId,
      });
      const rows = flattenWeeklySummary(result.data ?? []);
      results.push({ month: m, rows });
    } catch {
      // Silently skip months that error (no data)
    }
  }

  // Merge rows across months, dedup by staffId
  const staffMap = new Map<string, (typeof results)[number]['rows'][number]>();
  for (const { rows } of results) {
    for (const row of rows) {
      // Later month entries override earlier ones (same behavior as old multi-month)
      staffMap.set(row.staffId, row);
    }
  }
  let allRows = [...staffMap.values()];

  // Apply business-rule filter by default; explicit --status skips it
  if (!hasExplicitStatus) {
    allRows = [...filterActualByBusinessRule(allRows)];
  }

  // Apply explicit filters
  const filter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: opts.staffName,
    status: statusFilter,
  };
  const filtered = filterActualRows(allRows, filter);

  // Pivot
  const monthFrom = opts.from ?? months[0]!;
  const monthTo = opts.to ?? months[months.length - 1]!;
  const pivot = pivotActualRows(filtered, { from: monthFrom, to: monthTo });

  // Compute totals from flattened rows
  let totalHc = 0;
  let totalMp = 0;
  for (const row of filtered) {
    totalHc += row.headcount;
    totalMp += row.total;
  }

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      ...(opts.month ? { month: opts.month } : { from: monthFrom, to: monthTo }),
      filter: {
        status: statusFilter,
        department: opts.department ?? null,
        role: opts.role ?? null,
        staffName: opts.staffName ?? null,
        from: monthFrom,
        to: monthTo,
      },
      totalHc,
      totalMp,
      weekColumns: pivot.weekColumns,
      rows: pivot.rows.map((r) => ({
        staffId: r.staffId,
        staffName: r.staffName,
        role: r.role,
        teamLeadId: r.teamLeadId,
        teamLeadName: r.teamLeadName,
        status: r.status === 2 ? 'confirmed' : r.status === 1 ? 'approved' : 'pending',
        weekHours: r.weekHours,
        total: r.total,
        headcount: r.headcount,
      })),
    },
    {
      json: opts.json,
      meta: {
        rows: pivot.rows.length,
        weeks: pivot.weekColumns.length,
        months: months.length,
      },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderActualPivotTable(pivot));
        // eslint-disable-next-line no-console
        console.log(`\n${pivot.rows.length} 人 — ${projLabel}（${months.length} 个月）`);
      },
    },
  );
}