/**
 * `atlas actual` — query actual manpower hours (实际投入工时).
 *
 * Unlike `atlas month` which shows baseline (计划) data, this command queries
 * the actual hours reported by staff, grouped by team and approval status.
 *
 * Data source: `/yuntu-service/yida/manpower/getProjMpConfirmDetail.json`
 */
import { getClientOrExit } from './_client.js';
import { fetchManpowerConfirm, type ConfirmStatus } from './_manhours.js';
import { loadDepartments } from '../dict/cache.js';
import {
  flattenManpowerTree,
  filterActualRows,
  pivotActualRows,
  summarizeActual,
  renderActualPivotTable,
  renderActualSummaryTable,
  type ActualFilter,
  type ActualStatusFilter,
} from './_actual_logic.js';
import { resolveProjectIdAsync } from '../util/projectId.js';
import { ConfigError } from '../util/errors.js';
import { printResult } from '../util/output.js';

export interface ActualCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly month?: string;
  readonly department?: string;
  readonly role?: string;
  readonly staffName?: string;
  readonly status?: string; // 'pending' | 'approved' | 'all'
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
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

export async function actualCmd(opts: ActualCmdOpts): Promise<void> {
  validateMonth('--month', opts.month);
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  const statusFilter = parseStatusFilter(opts.status);

  const client = await getClientOrExit();
  const session = await import('../auth/session.js').then((m) => m.loadSession());
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const month = opts.month ?? getCurrentMonth();

  // Fetch actual manpower data with both pending and approved status
  const [pendingResult, approvedResult] = await Promise.all([
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 0, // pending
    }),
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 1, // approved
    }),
  ]);

  // Merge the trees: tag each row with its status
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

  // Combine rows, dedup by staffId (approved takes precedence)
  const staffMap = new Map<string, typeof pendingRows[number]>();
  for (const row of pendingRows) {
    staffMap.set(row.staffId, row);
  }
  for (const row of approvedRows) {
    staffMap.set(row.staffId, row);
  }
  const allRows = [...staffMap.values()];

  // Filter
  const filter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: opts.staffName,
    status: statusFilter,
  };
  const filtered = filterActualRows(allRows, filter);

  const monthFilter = { from: opts.from, to: opts.to };
  const pivot = pivotActualRows(filtered, monthFilter);

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  const out = pivot.rows.map((r) => ({
    staffId: r.staffId,
    staffName: r.staffName,
    role: r.role,
    teamLeadId: r.teamLeadId,
    teamLeadName: r.teamLeadName,
    status: r.status === 1 ? 'approved' : 'pending',
    weekHours: r.weekHours,
    total: r.total,
    headcount: r.headcount,
  }));

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      month,
      filter: {
        status: statusFilter,
        department: opts.department ?? null,
        role: opts.role ?? null,
        staffName: opts.staffName ?? null,
        from: opts.from ?? null,
        to: opts.to ?? null,
      },
      totalHc: (pendingResult.hc ?? 0) || (approvedResult.hc ?? 0),
      totalMp: (pendingResult.mp ?? 0) || (approvedResult.mp ?? 0),
      weekColumns: pivot.weekColumns,
      rows: out,
    },
    {
      json: opts.json,
      meta: {
        rows: pivot.rows.length,
        weeks: pivot.weekColumns.length,
        pendingRows: pendingRows.length,
        approvedRows: approvedRows.length,
      },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderActualPivotTable(pivot));
        // eslint-disable-next-line no-console
        console.log(
          `\n${pivot.rows.length} row(s) across ${pivot.weekColumns.length} week(s) in ${projLabel} (${month})`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `Status filter: ${statusFilter} (${pendingRows.length} pending, ${approvedRows.length} approved)`,
        );
      },
    },
  );
}
