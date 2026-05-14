import { getClientOrExit } from './_client.js';
import { fetchLinePlans } from './_lineplans.js';
import { decorateLinePlan, renderTable } from './_render.js';
import { loadDepartments, loadDictionary } from '../dict/cache.js';
import { resolveProjectIdAsync } from '../util/projectId.js';

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

  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          projectId,
          projectName: resolved.name,
          total: total ?? items.length,
          hasMore: hasMore ?? false,
          items,
        },
        null,
        2,
      ),
    );
    return;
  }

  const rows = items.map((it) => decorateLinePlan(it, dict, depts));
  // eslint-disable-next-line no-console
  console.log(renderTable(rows));
  const projLabel = resolved.name
    ? `project "${resolved.name}" (${projectId})`
    : `project ${projectId}`;
  // eslint-disable-next-line no-console
  console.log(
    `\n${items.length} item(s)${
      total !== undefined && total !== items.length ? ` (of ${total})` : ''
    } in ${projLabel}`,
  );
}
