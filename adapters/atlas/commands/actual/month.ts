/**
 * `atlas actual month` — 按月度查看各人员实际人力投入
 *
 * 按月汇总展示每个人员在指定月份的实际工时数据。
 */
import { getClientOrExit } from '../_client.js';
import { fetchManpowerConfirm } from '../_manhours.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import {
  flattenManpowerTree,
  filterActualRows,
  pivotActualRows,
  renderActualPivotTable,
  type ActualFilter,
  type ActualStatusFilter,
} from '../_actual_logic.js';
import { loadSession } from '../../auth/session.js';

export interface ActualMonthCmdOpts {
  readonly projectId?: string;
  readonly month?: string;
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

export async function monthCmd(opts: ActualMonthCmdOpts): Promise<void> {
  validateMonth('--month', opts.month);

  const statusFilter = parseStatusFilter(opts.status);

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

  const [pendingResult, approvedResult] = await Promise.all([
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 0,
    }),
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 1,
    }),
  ]);

  const pendingRows = flattenManpowerTree(pendingResult.teamMp ?? [], '', '', 0);
  const approvedRows = flattenManpowerTree(approvedResult.teamMp ?? [], '', '', 1);

  const staffMap = new Map<string, typeof pendingRows[number]>();
  for (const row of pendingRows) staffMap.set(row.staffId, row);
  for (const row of approvedRows) staffMap.set(row.staffId, row);
  const allRows = [...staffMap.values()];

  const filter: ActualFilter = {
    department: opts.department,
    role: opts.role,
    staffName: opts.staffName,
    status: statusFilter,
  };
  const filtered = filterActualRows(allRows, filter);

  // Single month pivot (just this month's data)
  const pivot = pivotActualRows(filtered, { from: month, to: month });

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

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
      },
      weekColumns: pivot.weekColumns,
      rows: pivot.rows.map((r) => ({
        staffId: r.staffId,
        staffName: r.staffName,
        role: r.role,
        teamLeadId: r.teamLeadId,
        teamLeadName: r.teamLeadName,
        status: r.status === 1 ? 'approved' : 'pending',
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
      },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderActualPivotTable(pivot));
        // eslint-disable-next-line no-console
        console.log(
          `\n${pivot.rows.length} person(s) in ${projLabel} (${month})`,
        );
      },
    },
  );
}