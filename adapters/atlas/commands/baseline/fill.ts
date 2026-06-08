import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getClientOrExit } from '../_client.js';
import {
  fetchLinePlans,
  fetchLinePlanMonths,
  saveLinePlans,
  saveLinePlanMonths,
} from '../_lineplans.js';
import {
  buildStagedUpdate,
  parseRenderedJson,
  renderTemplate,
  type StagedUpdate,
} from '../_fill_render.js';
import { callClaude, getAnthropicKey } from '../_llm.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult } from '../../util/output.js';
import { newToken, writeManifest } from '../../util/undo.js';
import type { LinePlan, LinePlanMonth } from '../../schema/models.js';

const DEFAULT_LLM_MODEL = 'claude-3-5-sonnet-latest';
const VALID_TARGETS = new Set<FillTarget>(['lineplan', 'month']);

export type FillTarget = 'lineplan' | 'month';

export interface FillCmdOpts {
  readonly projectId?: string;
  readonly template: string;
  readonly out?: string;
  readonly llm?: string;
  readonly apply?: boolean;
  readonly json?: boolean;
  readonly target?: string;
  readonly refreshProjects?: boolean;
}

interface FillOutcome {
  readonly projectId: string;
  readonly mode: 'dry-run' | 'apply';
  readonly target: FillTarget;
  readonly stagePath: string;
  readonly rowsConsidered: number;
  readonly rowsStaged: number;
  readonly rowsSkipped: number;
  readonly llmEnabled: boolean;
  readonly applied?: number;
  readonly serverResponse?: unknown;
  readonly updates: ReadonlyArray<StagedUpdate>;
  readonly undoToken?: string;
}

export function parseFillTarget(raw: string | undefined): FillTarget {
  const v = (raw ?? 'lineplan') as FillTarget;
  if (!VALID_TARGETS.has(v)) {
    throw new ConfigError(`--target must be lineplan|month (got "${raw}")`);
  }
  return v;
}

export async function fillCmd(opts: FillCmdOpts): Promise<void> {
  if (!opts.template) {
    throw new ConfigError('--template <path> is required.');
  }
  const target = parseFillTarget(opts.target);

  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  if (opts.apply) {
    await runApply(projectId, target, opts);
    return;
  }

  const outcome = await runStage(projectId, target, opts);
  emitOutcome(outcome, opts);
}

async function runStage(
  projectId: string,
  target: FillTarget,
  opts: FillCmdOpts,
): Promise<FillOutcome> {
  const template = await readFile(opts.template, 'utf8');
  const client = await getClientOrExit();
  const items: ReadonlyArray<LinePlan | LinePlanMonth> =
    target === 'month'
      ? (await fetchLinePlanMonths(client, { projectId })).items
      : (await fetchLinePlans(client, { projectId })).items;

  const llmKey = opts.llm ? getAnthropicKey() : null;
  const llmEnabled = Boolean(opts.llm && llmKey);
  if (opts.llm && !llmKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[fill] --llm set but ANTHROPIC_API_KEY missing; falling back to template-only.',
    );
  }

  const updates: StagedUpdate[] = [];
  let skipped = 0;

  for (const row of items) {
    const rendered = renderTemplate(template, { row: row as LinePlan, projectId });

    let llmPatch: Record<string, unknown> | null = null;
    if (llmEnabled && llmKey) {
      llmPatch = await callLlmForRow(rendered, opts.llm ?? DEFAULT_LLM_MODEL, llmKey);
    }

    const tplParsed = parseRenderedJson(rendered);
    if (!tplParsed && !llmPatch) {
      skipped += 1;
      continue;
    }

    updates.push(buildStagedUpdate(row as LinePlan, rendered, llmPatch));
  }

  const stagePath = opts.out ?? defaultStagePath(projectId);
  await writeStage(stagePath, projectId, target, updates);

  return {
    projectId,
    mode: 'dry-run',
    target,
    stagePath,
    rowsConsidered: items.length,
    rowsStaged: updates.length,
    rowsSkipped: skipped,
    llmEnabled,
    updates,
  };
}

async function runApply(
  projectId: string,
  target: FillTarget,
  opts: FillCmdOpts,
): Promise<void> {
  const stagePath = opts.out;
  if (!stagePath) {
    throw new ConfigError('--apply requires --out <path> pointing at a staged JSON file.');
  }
  const raw = await readFile(stagePath, 'utf8');
  const parsed = parseStageFile(raw);
  if (parsed.projectId !== projectId) {
    throw new ConfigError(
      `Stage file projectId (${parsed.projectId}) does not match --project-id (${projectId}).`,
    );
  }
  // If the stage file declares a target, it must agree with the flag.
  if (parsed.target && parsed.target !== target) {
    throw new ConfigError(
      `Stage file target (${parsed.target}) does not match --target (${target}).`,
    );
  }
  if (parsed.updates.length === 0) {
    printResult(
      { applied: 0, message: 'No staged updates to apply.' },
      {
        json: opts.json,
        renderHuman: () => {
          // eslint-disable-next-line no-console
          console.log('No staged updates to apply.');
        },
      },
    );
    return;
  }

  const client = await getClientOrExit();
  const payload = parsed.updates.map((u) => u.update);
  const save = target === 'month' ? saveLinePlanMonths : saveLinePlans;
  const { count, raw: serverResponse } = await save(client, { projectId }, payload);

  const undoToken = await maybeWriteUndoManifest(
    projectId,
    target,
    parsed.updates,
    serverResponse,
  );

  const result: FillOutcome = {
    projectId,
    mode: 'apply',
    target,
    stagePath,
    rowsConsidered: parsed.updates.length,
    rowsStaged: parsed.updates.length,
    rowsSkipped: 0,
    llmEnabled: false,
    applied: count,
    serverResponse,
    updates: parsed.updates,
    ...(undoToken ? { undoToken } : {}),
  };
  emitOutcome(result, opts);
}

async function maybeWriteUndoManifest(
  projectId: string,
  target: FillTarget,
  updates: ReadonlyArray<StagedUpdate>,
  serverResponse: unknown,
): Promise<string | undefined> {
  // We need every staged update to carry an `original` snapshot. Stage files
  // written before P2 won't, so skip the manifest in that case rather than
  // fabricate a partial one.
  const before: Array<Record<string, unknown>> = [];
  for (const u of updates) {
    if (!u.original) return undefined;
    before.push(u.original);
  }
  const after = updates.map((u) => u.update);
  const token = newToken('fill', projectId);
  await writeManifest({
    token,
    command: 'fill',
    target,
    projectId,
    timestamp: new Date().toISOString(),
    before,
    after,
    serverResponse,
  });
  return token;
}

async function callLlmForRow(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await callClaude({ model, prompt, apiKey });
    return parseRenderedJson(text);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[fill] LLM call failed: ${(e as Error).message}`);
    return null;
  }
}

function defaultStagePath(projectId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `./fill-stage-${projectId}-${ts}.json`;
}

interface StageFile {
  readonly projectId: string;
  readonly target?: FillTarget;
  readonly updates: ReadonlyArray<StagedUpdate>;
}

async function writeStage(
  path: string,
  projectId: string,
  target: FillTarget,
  updates: ReadonlyArray<StagedUpdate>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file: StageFile = { projectId, target, updates };
  await writeFile(path, JSON.stringify(file, null, 2), 'utf8');
}

export function parseStageFile(raw: string): StageFile {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('projectId' in parsed) ||
    !('updates' in parsed) ||
    !Array.isArray((parsed as StageFile).updates)
  ) {
    throw new ConfigError('Stage file is malformed (expected {projectId, updates[]}).');
  }
  const sf = parsed as StageFile;
  const target =
    sf.target && VALID_TARGETS.has(sf.target) ? sf.target : undefined;
  return {
    projectId: String(sf.projectId),
    ...(target ? { target } : {}),
    updates: sf.updates,
  };
}

function emitOutcome(outcome: FillOutcome, opts: FillCmdOpts): void {
  printResult(outcome, {
    json: opts.json,
    meta: { mode: outcome.mode, target: outcome.target },
    renderHuman: () => {
      // eslint-disable-next-line no-console
      console.log(
        [
          `mode: ${outcome.mode}`,
          `target: ${outcome.target}`,
          `projectId: ${outcome.projectId}`,
          `rows considered: ${outcome.rowsConsidered}`,
          `rows staged: ${outcome.rowsStaged}`,
          `rows skipped: ${outcome.rowsSkipped}`,
          `llm enabled: ${outcome.llmEnabled}`,
          `stage: ${outcome.stagePath}`,
          ...(outcome.applied !== undefined ? [`applied: ${outcome.applied}`] : []),
          ...(outcome.undoToken ? [`undo token: ${outcome.undoToken}`] : []),
          outcome.mode === 'dry-run' ? 'Re-run with --apply to commit updates.' : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  });
}

// Exported for tests
export const __testing = {
  buildStagedUpdate,
  parseRenderedJson,
  renderTemplate,
  defaultStagePath,
} as const;

export type { LinePlan };