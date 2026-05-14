import { getClientOrExit } from './_client.js';
import { fetchLinePlans } from './_lineplans.js';
import { decorateLinePlan } from './_render.js';
import { loadDepartments, loadDictionary } from '../dict/cache.js';
import { resolveProjectIdAsync } from '../util/projectId.js';

export interface ShowCmdOpts {
  readonly projectId?: string;
  readonly json?: boolean;
  readonly refreshProjects?: boolean;
}

export async function showCmd(itemId: string, opts: ShowCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  // TODO: replace with native /yuntu-service/line/plan/detail.json once
  // recon captures it (see docs/recon/mpline.md §8.2).
  const [{ items }, dict, depts] = await Promise.all([
    fetchLinePlans(client, { projectId }),
    loadDictionary(client),
    loadDepartments(client),
  ]);

  const match = items.find((it) => String(it.id) === String(itemId));
  if (!match) {
    // eslint-disable-next-line no-console
    console.error(`Item ${itemId} not found in project ${projectId}.`);
    process.exitCode = 2;
    return;
  }

  const decorated = decorateLinePlan(match, dict, depts);
  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...decorated, raw: match }, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`LinePlan ${decorated.id}`);
  // eslint-disable-next-line no-console
  console.log('-'.repeat(40));
  for (const [k, v] of Object.entries(decorated)) {
    if (k === 'raw') continue;
    // eslint-disable-next-line no-console
    console.log(`${k.padEnd(14)} ${String(v ?? '')}`);
  }
  // eslint-disable-next-line no-console
  console.log('\nraw:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(match, null, 2));
}
