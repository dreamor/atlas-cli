/**
 * `atlas actual summary --by <axis>` — aggregate actual hours by month/department/role.
 *
 * 使用新 API（summaryByTeam），数据已是人月。
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
  summarizeActual,
  renderActualSummaryTable,
  type ActualFilter,
  type ActualStatusFilter,
  type ActualSummaryAxis,
} from '../_actual_logic.js';
import { loadSession } from '../../auth/session.js';

export interface ActualSummaryCmdOpts {
  readonly projectId?: string;
  readonly month?: string;
  readonly status?: string;
  readonly department?: string;
  readonly role?: string;
  readonly by?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
  readonly json?: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const VALID_AXES: ReadonlySet<ActualSummaryAxis> = new Set(['month', 'department', 'role']);

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

function parseAxis(raw: string | undefined): ActualSummaryAxis {
  const v = (raw ?? 'month') as ActualSummaryAxis;
  if (!VALID_AXES.has(v)) {
    throw new ConfigError(`--by must be one of month|department|role (got "${raw}")`);
  }
  return v;
}

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function summaryCmd(opts: ActualSummaryCmdOpts): Promise<void> {
  validateMonth('--month', opts.month);
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  const statusFilter = parseStatusFilter(opts.status);
  const axis = parseAxis(opts.by);
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
  const month = opts.month ?? getCurrentMonth();

  const result = await fetchWeeklySummary(client, {
    month,
    staffId: session.empId,
  });

  let allRows = flattenWeeklySummary(result.data ?? []);

  // Apply business-rule filter by default; explicit --status skips it
  if (!hasExplicitStatus) {
    allRows = [...filterActualByBusinessRule(allRows)];
  }

  const filter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: undefined,
    status: statusFilter,
  };
  const filtered = filterActualRows(allRows, filter);

  const summary = summarizeActual(filtered, axis, {
    from: opts.from,
    to: opts.to,
  });

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      month,
      by: axis,
      filter: {
        status: statusFilter,
        department: opts.department ?? null,
        role: opts.role ?? null,
        from: opts.from ?? null,
        to: opts.to ?? null,
      },
      entries: summary,
    },
    {
      json: opts.json,
      meta: { rows: summary.length },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderActualSummaryTable(axis, summary));
        // eslint-disable-next-line no-console
        const unit = axis === 'month' ? '个月' : axis === 'department' ? '个部门' : '种角色';
        console.log(`\n共 ${summary.length} ${unit}（按${axis === 'month' ? '月份' : axis === 'department' ? '部门' : '角色'}汇总）— ${projLabel}`);
      },
    },
  );
}