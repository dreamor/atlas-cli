import { getClientOrExit } from '../_client.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { clearLink, readLink, writeLink } from '../../util/link.js';
import { printResult } from '../../util/output.js';

export interface LinkCmdOpts {
  readonly json?: boolean;
  readonly refreshProjects?: boolean;
}

/**
 * `atlas link <project>` — pin a project so subsequent commands can omit
 * `--project-id`. Validates the input by resolving it through the project
 * catalog (accepts numeric id, exact name, or unique substring).
 */
export async function linkCmd(query: string, opts: LinkCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(query, client, {
    refresh: opts.refreshProjects,
  });

  const linkedAt = new Date().toISOString();
  await writeLink({
    projectId: resolved.id,
    ...(resolved.name !== undefined ? { projectName: resolved.name } : {}),
    linkedAt,
  });

  printResult(
    {
      projectId: resolved.id,
      projectName: resolved.name ?? null,
      linkedAt,
    },
    {
      json: opts.json,
      renderHuman: () => {
        const label = resolved.name
          ? `"${resolved.name}" (${resolved.id})`
          : resolved.id;
        // eslint-disable-next-line no-console
        console.log(`Linked to project ${label}. Subsequent commands will use it by default.`);
      },
    },
  );
}

/**
 * `atlas unlink` — clear the persistent project link. Idempotent.
 */
export async function unlinkCmd(opts: { json?: boolean }): Promise<void> {
  const prior = await readLink();
  const removed = await clearLink();
  printResult(
    {
      removed,
      previous: prior
        ? {
            projectId: prior.projectId,
            projectName: prior.projectName ?? null,
            linkedAt: prior.linkedAt,
          }
        : null,
    },
    {
      json: opts.json,
      renderHuman: () => {
        if (!removed) {
          // eslint-disable-next-line no-console
          console.log('No project was linked.');
          return;
        }
        const label = prior?.projectName
          ? `"${prior.projectName}" (${prior?.projectId})`
          : prior?.projectId ?? '';
        // eslint-disable-next-line no-console
        console.log(`Unlinked project ${label}.`);
      },
    },
  );
}

/**
 * `atlas link` (no arg) — show the currently linked project (if any).
 */
export async function linkStatusCmd(opts: { json?: boolean }): Promise<void> {
  const link = await readLink();
  if (!link) {
    printResult(
      { linked: false },
      {
        json: opts.json,
        hint: 'Run \`atlas link <project>\` to pin a project.',
        renderHuman: () => {
          // eslint-disable-next-line no-console
          console.log('No project linked. Run \`atlas link <project>\` to pin one.');
        },
      },
    );
    return;
  }
  printResult(
    {
      linked: true,
      projectId: link.projectId,
      projectName: link.projectName ?? null,
      linkedAt: link.linkedAt,
    },
    {
      json: opts.json,
      renderHuman: () => {
        const label = link.projectName
          ? `"${link.projectName}" (${link.projectId})`
          : link.projectId;
        // eslint-disable-next-line no-console
        console.log(`Linked to project ${label}. Pinned at ${link.linkedAt}.`);
      },
    },
  );
}