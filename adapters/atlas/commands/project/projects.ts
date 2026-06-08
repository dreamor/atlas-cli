/**
 * `atlas projects` — list all projects I have access to.
 *
 * NEW command that queries the project catalog and displays the full list.
 */
import { getClientOrExit } from '../_client.js';
import { loadProjectCatalog } from '../../dict/projectCatalog.js';
import { printResult } from '../../util/output.js';

export interface ProjectsCmdOpts {
  readonly json?: boolean;
  readonly refresh?: boolean;
}

export async function projectsCmd(opts: ProjectsCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const catalog = await loadProjectCatalog(client, { refresh: opts.refresh });

  printResult(
    {
      count: catalog.length,
      projects: catalog.map((p) => ({
        id: String(p.id),
        name: p.name,
        status: p.status,
      })),
    },
    {
      json: opts.json,
      meta: { count: catalog.length },
      renderHuman: () => {
        /* eslint-disable no-console */
        console.log(`Projects (${catalog.length} total):`);
        console.log('-'.repeat(60));
        for (const p of catalog) {
          const statusLabel = p.status === 1 ? '' : ' (inactive)';
          console.log(`  ${String(p.id).padEnd(8)} ${p.name}${statusLabel}`);
        }
        /* eslint-enable no-console */
      },
    },
  );
}