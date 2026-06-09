import { getClientOrExit } from '../_client.js';
import { fetchLinePlanMonths } from '../_lineplans.js';
import { loadDepartments } from '../../dict/cache.js';
import { resolveDept } from '../../dict/resolve.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import {
  applyRowFilter,
  dropAllZero,
  pivotMonths,
  renderPivotTable,
  type DepartmentResolver,
} from '../_month_logic.js';

export interface MonthCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly department?: string;
  readonly role?: string;
  readonly areaCode?: string;
  readonly mpType?: string;
  readonly month?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
  readonly allMonths?: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateMonth(label: string, val: string | undefined): void {
  if (val === undefined) return;
  if (!MONTH_RE.test(val)) {
    throw new ConfigError(`${label} must be YYYY-MM (got "${val}")`);
  }
}

export async function monthCmd(opts: MonthCmdOpts): Promise<void> {
  validateMonth('--month', opts.month);
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);

  // --month maps to from=month, to=month
  const from = opts.month ?? opts.from;
  const to = opts.month ?? opts.to;

  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const [{ items, total }, depts] = await Promise.all([
    fetchLinePlanMonths(client, { projectId }),
    loadDepartments(client),
  ]);

  const resolveDepartment: DepartmentResolver = (id) =>
    resolveDept(depts, (id ?? null) as string | number | null) ?? '';

  const filtered = applyRowFilter(
    items,
    { department: opts.department, role: opts.role, areaCode: opts.areaCode, mpType: opts.mpType },
    resolveDepartment,
  );
  let pivot = pivotMonths(
    filtered,
    { from, to },
    resolveDepartment,
  );

  // 默认过滤全零月份列和全零行，只显示有人力的数据
  if (!opts.allMonths) {
    pivot = dropAllZero(pivot);
  }

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  const out = pivot.rows.map((r) => ({
    id: r.id,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    role: r.role,
    areaCode: r.areaCode,
    mpType: r.mpType,
    remark: r.remark,
    months: r.months,
  }));

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      total: total ?? items.length,
      monthColumns: pivot.monthColumns,
      rows: out,
    },
    {
      json: opts.json,
      meta: { rows: pivot.rows.length, months: pivot.monthColumns.length },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderPivotTable(pivot));
        // eslint-disable-next-line no-console
        console.log(`\n${pivot.rows.length} 行，${pivot.monthColumns.length} 个月 — ${projLabel}`);
      },
    },
  );
}