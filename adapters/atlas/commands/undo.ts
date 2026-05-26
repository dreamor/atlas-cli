/**
 * `atlas undo <token>` and `atlas undo --list` — reverse a prior fill apply.
 *
 * Mechanics: load the manifest, POST manifest.before back to the same save
 * endpoint, mark the manifest as undone. Re-undoing the same token is
 * rejected. Currently only `fill` produces manifests (see util/undo.ts).
 */

import { getClientOrExit } from './_client.js';
import { saveLinePlans, saveLinePlanMonths } from './_lineplans.js';
import { ConfigError } from '../util/errors.js';
import { printResult } from '../util/output.js';
import {
  listManifests,
  loadManifest,
  markUndone,
  type UndoTarget,
} from '../util/undo.js';

export interface UndoCmdOpts {
  readonly list?: boolean;
  readonly limit?: string;
  readonly json?: boolean;
}

export async function undoCmd(
  token: string | undefined,
  opts: UndoCmdOpts,
): Promise<void> {
  if (opts.list) {
    await runList(opts);
    return;
  }
  if (!token) {
    throw new ConfigError(
      'Provide an undo token or pass --list to enumerate. ' +
        'Tokens are returned by `atlas fill ... --apply`.',
    );
  }
  await runUndo(token, opts);
}

async function runList(opts: UndoCmdOpts): Promise<void> {
  const limit = parseLimit(opts.limit);
  const summaries = await listManifests(limit);
  printResult(
    { count: summaries.length, manifests: summaries },
    {
      json: opts.json,
      meta: { limit },
      renderHuman: () => {
        if (summaries.length === 0) {
          // eslint-disable-next-line no-console
          console.log('(no undo manifests)');
          return;
        }
        for (const s of summaries) {
          // eslint-disable-next-line no-console
          console.log(
            `${s.token}  ${s.timestamp}  ${s.command}/${s.target}  ` +
              `project=${s.projectId}  rows=${s.rowCount}  ` +
              (s.undone ? 'UNDONE' : 'reversible'),
          );
        }
      },
    },
  );
}

async function runUndo(token: string, opts: UndoCmdOpts): Promise<void> {
  const manifest = await loadManifest(token);
  if (manifest.undoneAt) {
    throw new ConfigError(
      `Manifest ${token} was already undone at ${manifest.undoneAt}.`,
    );
  }
  if (manifest.command !== 'fill') {
    throw new ConfigError(
      `Cannot undo manifest ${token}: command "${manifest.command}" is not reversible.`,
    );
  }

  const client = await getClientOrExit();
  const save = pickSaveFn(manifest.target);
  // `before` already contains the entire row payload — save endpoints accept
  // the same shape they returned, so we pass it through unchanged.
  const payload = manifest.before.map((row) => ({ ...row }));
  const { count, raw: serverResponse } = await save(
    client,
    { projectId: manifest.projectId },
    payload,
  );

  const updated = await markUndone(token);

  printResult(
    {
      token,
      command: manifest.command,
      target: manifest.target,
      projectId: manifest.projectId,
      reversedRows: count,
      undoneAt: updated.undoneAt,
      serverResponse,
    },
    {
      json: opts.json,
      meta: { rows: count },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(
          `Undone ${token}: reverted ${count} row(s) on project ${manifest.projectId}.`,
        );
      },
    },
  );
}

function pickSaveFn(target: UndoTarget): typeof saveLinePlans {
  if (target === 'month') return saveLinePlanMonths;
  return saveLinePlans;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`--limit must be a positive integer (got "${raw}")`);
  }
  return n;
}
