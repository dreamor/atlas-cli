import { getClientOrExit } from '../_client.js';
import { fetchLinePlans } from '../_lineplans.js';
import { decorateLinePlan, renderTable } from '../_render.js';
import { loadDepartments, loadDictionary } from '../../dict/cache.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { printResult } from '../../util/output.js';

export interface ListCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly page?: string;
  readonly pageSize?: string;
  readonly refreshProjects?: boolean;
}

export async function listCmd(opts: ListCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  const page = opts.page ? Number(opts.page) : undefined;
  const pageSize = opts.pageSize ? Number(opts.pageSize) : undefined;

  const [{ items, total, hasMore }, dict, depts] = await Promise.all([
    fetchLinePlans(client, { projectId, page, pageSize }),
    loadDictionary(client),
    loadDepartments(client),
  ]);

  const rows = items.map((it) => decorateLinePlan(it, dict, depts));
  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;

  printResult(
    {
      projectId,
      projectName: resolved.name ?? null,
      total: total ?? items.length,
      hasMore: hasMore ?? false,
      items,
    },
    {
      json: opts.json,
      meta: { count: items.length },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(renderTable(rows));
        // eslint-disable-next-line no-console
        console.log(
          `\n${items.length} item(s)${
            total !== undefined && total !== items.length ? ` (of ${total})` : ''
          } in ${projLabel}`,
        );
      },
    },
  );
}