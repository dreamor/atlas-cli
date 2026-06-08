import { getClientOrExit } from '../_client.js';
import { fetchLinePlanMonths } from '../_lineplans.js';
import { loadDepartments } from '../../dict/cache.js';
import { resolveDept } from '../../dict/resolve.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import {
  renderSummaryTable,
  summarizeMonths,
  type DepartmentResolver,
  type SummaryAxis,
} from '../_month_logic.js';

export interface SummaryCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly by?: string;
  readonly from?: string;
  readonly to?: string;
  readonly refreshProjects?: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const VALID_AXES: ReadonlySet<SummaryAxis> = new Set(['month', 'department', 'role']);

function validateMonth(label: string, val: string | undefined): void {
  if (val === undefined) return;
  if (!MONTH_RE.test(val)) {
    throw new ConfigError(`${label} must be YYYY-MM (got "${val}")`);
  }
}

function parseAxis(raw: string | undefined): SummaryAxis {
  const v = (raw ?? 'month') as SummaryAxis;
  if (!VALID_AXES.has(v)) {
    throw new ConfigError(`--by must be one of month|department|role (got "${raw}")`);
  }
  return v;
}

export async function summaryCmd(opts: SummaryCmdOpts): Promise<void> {
  validateMonth('--from', opts.from);
  validateMonth('--to', opts.to);
  const axis = parseAxis(opts.by);

  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const [{ items }, depts] = await Promise.all([
    fetchLinePlanMonths(client, { projectId }),
    loadDepartments(client),
  ]);

  const resolveDepartment: DepartmentResolver = (id) =>
    resolveDept(depts, (id ?? null) as string | number | null) ?? '';

  const entries = summarizeMonths(items, {
    by: axis,
    filter: { from: opts.from, to: opts.to },
    resolveDepartment,
  });

  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      by: axis,
      entries,
    },
    {
      json: opts.json,
      meta: { buckets: entries.length },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderSummaryTable(axis, entries));
        // eslint-disable-next-line no-console
        console.log(`\n${entries.length} bucket(s) by ${axis} in ${projLabel}`);
      },
    },
  );
}