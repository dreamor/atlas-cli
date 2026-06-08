/**
 * `atlas actual summary --by <axis>` — aggregate actual hours by month/department/role.
 */
import { getClientOrExit } from '../_client.js';
import { fetchManpowerConfirm } from '../_manhours.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import {
  flattenManpowerTree,
  filterActualRows,
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
        console.log(`\n${summary.length} bucket(s) by ${axis} in ${projLabel} (${month})`);
      },
    },
  );
}