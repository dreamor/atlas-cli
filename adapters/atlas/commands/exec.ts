/**
 * `atlas exec --plan-file <path>` — batch-run a list of atlas commands.
 *
 * Plan file shape (zod-validated):
 *   {
 *     steps: [
 *       { name?: "...", cmd: "list", args: { "--project-id": "2548", "--json": true } },
 *       { name?: "...", cmd: "month", args: { "--project-id": "2548" } }
 *     ],
 *     stopOnError?: true     // default true
 *   }
 *
 * Each step is dispatched in-process by re-parsing argv against a fresh
 * Commander instance and capturing the JSON envelope written to stdout.
 * In-process dispatch avoids fork issues with Bun-compiled single binaries
 * (where argv[1] is a virtual fs path that the spawned child can't resolve).
 *
 * Output is collected and re-emitted as a top-level envelope:
 *   { ok, steps: [{name, cmd, exitCode, result?, error?}], stoppedAt?: idx }
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigError } from '../util/errors.js';
import { printResult } from '../util/output.js';
import type { ErrorEnvelope, SuccessEnvelope } from '../util/output.js';

const ArgsSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

const StepSchema = z.object({
  name: z.string().optional(),
  cmd: z.string().min(1),
  args: ArgsSchema.optional(),
});

const PlanSchema = z.object({
  steps: z.array(StepSchema).min(1),
  stopOnError: z.boolean().optional(),
});

export type ExecStep = z.infer<typeof StepSchema>;
export type ExecPlan = z.infer<typeof PlanSchema>;

export interface ExecCmdOpts {
  readonly planFile?: string;
  readonly json?: boolean;
}

interface StepResult {
  readonly name: string;
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
  readonly exitCode: number;
  readonly result?: unknown;
  readonly error?: unknown;
}

export async function execCmd(opts: ExecCmdOpts): Promise<void> {
  if (!opts.planFile) {
    throw new ConfigError('--plan-file <path> is required.');
  }
  const plan = await loadPlan(opts.planFile);
  const stopOnError = plan.stopOnError ?? true;

  const results: StepResult[] = [];
  let stoppedAt: number | undefined;
  let overallOk = true;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const stepResult = await runStep(step);
    results.push(stepResult);
    if (stepResult.exitCode !== 0) {
      overallOk = false;
      if (stopOnError) {
        stoppedAt = i;
        break;
      }
    }
  }

  printResult(
    {
      steps: results,
      ...(stoppedAt !== undefined ? { stoppedAt } : {}),
    },
    {
      json: opts.json,
      meta: { count: results.length, ok: overallOk },
      renderHuman: () => {
        /* eslint-disable no-console */
        for (const r of results) {
          const status = r.exitCode === 0 ? 'OK ' : 'ERR';
          console.log(`[${status}] ${r.name}  exit=${r.exitCode}`);
        }
        if (stoppedAt !== undefined) {
          console.log(`(stopped at step ${stoppedAt} due to stopOnError)`);
        }
        /* eslint-enable no-console */
      },
    },
  );

  if (!overallOk) process.exitCode = 1;
}

async function loadPlan(path: string): Promise<ExecPlan> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`Cannot read plan file: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`Plan file is not valid JSON: ${(e as Error).message}`);
  }
  const result = PlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Plan file does not match expected schema: ${result.error.message}`);
  }
  return result.data;
}

async function runStep(step: ExecStep): Promise<StepResult> {
  const name = step.name ?? step.cmd;
  const flags = renderArgs(step.args ?? {});
  // `from: 'user'` mode means argv items map directly to user args (no node/script prefix).
  const argv = [...step.cmd.split(/\s+/).filter(Boolean), ...flags];

  // Capture stdout, suppress process.exit so a single failing step doesn't
  // tear down the whole batch.
  const captured = await captureChild(argv);
  const parsed = parseEnvelope(captured.stdout);

  const result: StepResult = {
    name,
    cmd: step.cmd,
    args: flags,
    exitCode: captured.exitCode,
    ...(parsed.ok && parsed.envelope?.ok === true
      ? { result: parsed.envelope }
      : {
          error:
            parsed.envelope ?? {
              ok: false,
              code: 'CONFIG_ERROR',
              message: captured.stderr || 'no output',
            },
        }),
  };
  return result;
}

interface CapturedRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function captureChild(argv: ReadonlyArray<string>): Promise<CapturedRun> {
  // Suppress cli.ts auto-run before importing; otherwise the import itself
  // would re-execute the parent command.
  const previousSkip = process.env.ATLAS_SKIP_AUTORUN;
  process.env.ATLAS_SKIP_AUTORUN = '1';
  // Lazy-import buildProgram to avoid a circular dep with cli.ts at module
  // load time.
  const { buildProgram } = await import('../cli.js');
  // Restore the env var afterwards so subsequent imports behave normally.
  if (previousSkip === undefined) delete process.env.ATLAS_SKIP_AUTORUN;
  else process.env.ATLAS_SKIP_AUTORUN = previousSkip;

  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalExit = process.exit;
  const previousExitCode = process.exitCode;
  let intercepted = 0;

  process.stdout.write = ((chunk: unknown) => {
    stdout += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as unknown as typeof process.stderr.write;
  // Intercept process.exit so a child step that hits handleError doesn't kill
  // the whole batch.
  process.exit = ((code?: number) => {
    intercepted = code ?? 0;
    throw new ChildExitSignal(intercepted);
  }) as unknown as typeof process.exit;

  let exitCode = 0;
  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(argv as string[], { from: 'user' });
  } catch (err) {
    if (err instanceof ChildExitSignal) {
      exitCode = err.code;
    } else if (typeof err === 'object' && err !== null && 'code' in err) {
      // Commander's exitOverride throws a CommanderError; treat unknown
      // commander failures as exit 1 unless the cli set a real code first.
      exitCode = numericExit(process.exitCode) ?? 1;
    } else {
      exitCode = 1;
    }
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exit = originalExit;
    if (exitCode === 0) {
      exitCode = numericExit(process.exitCode) ?? 0;
    }
    process.exitCode = previousExitCode;
  }
  return { stdout, stderr, exitCode };
}

function numericExit(code: string | number | null | undefined): number | undefined {
  if (typeof code === 'number') return code;
  if (typeof code === 'string') {
    const n = Number(code);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

class ChildExitSignal {
  constructor(public readonly code: number) {}
}

function renderArgs(args: Record<string, string | number | boolean>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const flag = key.startsWith('--') || key.startsWith('-') ? key : `--${key}`;
    if (value === true) {
      out.push(flag);
    } else if (value === false) {
      // Skip false booleans; presence of flag implies on.
    } else {
      out.push(flag, String(value));
    }
  }
  return out;
}

interface ParsedEnvelope {
  ok: boolean;
  envelope: SuccessEnvelope<unknown> | ErrorEnvelope | undefined;
}

function parseEnvelope(stdout: string): ParsedEnvelope {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false, envelope: undefined };
  // A child may emit multiple lines (extra logs); take the last JSON line.
  const lines = trimmed.split('\n').filter((l) => l.startsWith('{'));
  const last = lines[lines.length - 1];
  if (!last) return { ok: false, envelope: undefined };
  try {
    const env = JSON.parse(last) as SuccessEnvelope<unknown> | ErrorEnvelope;
    return { ok: env.ok === true, envelope: env };
  } catch {
    return { ok: false, envelope: undefined };
  }
}
