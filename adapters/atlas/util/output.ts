/**
 * Uniform output for the Atlas CLI.
 *
 * Two channels:
 *   - stdout: machine-friendly. JSON envelope when JSON mode is on, otherwise
 *     whatever the command's render callback wants to write.
 *   - stderr: human notes (progress, hints, warnings). Always plain text.
 *
 * JSON mode is enabled when EITHER:
 *   - the global `--json` flag was passed (Commander option `json`), OR
 *   - the env var `ATLAS_OUTPUT=json` (or `ATLAS_JSON=1`) is set
 *
 * The envelope is stable across all commands:
 *   success → { ok: true, data, meta?, hint? }
 *   error   → { ok: false, code, message, hint?, details? }
 *
 * Skills key off `ok`, `code`, and `details`. Do not change these names.
 */

import { isAtlasError, type SerializedAtlasError } from './errors.js';

export interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: Record<string, unknown>;
  readonly hint?: string;
}

export interface ErrorEnvelope extends SerializedAtlasError {
  readonly ok: false;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface PrintOptions {
  /** Command-local --json flag (overrides env when true). */
  readonly json?: boolean;
  /** Renderer for human (table/text) mode. Called only when JSON mode is off. */
  readonly renderHuman?: () => void;
  /** Optional metadata, e.g. pagination, project name. */
  readonly meta?: Record<string, unknown>;
  /** Optional hint for the user. */
  readonly hint?: string;
}

export function isJsonMode(opts?: Pick<PrintOptions, 'json'>): boolean {
  if (opts?.json === true) return true;
  const envOut = process.env.ATLAS_OUTPUT;
  if (envOut !== undefined && envOut.toLowerCase() === 'json') return true;
  if (process.env.ATLAS_JSON === '1') return true;
  return false;
}

/**
 * Print a successful result. In JSON mode writes the envelope to stdout; in
 * human mode invokes `renderHuman` (or does nothing if the renderer is
 * omitted).
 */
export function printResult<T>(data: T, opts: PrintOptions = {}): void {
  if (isJsonMode(opts)) {
    const envelope: SuccessEnvelope<T> = buildSuccess(data, opts);
    process.stdout.write(JSON.stringify(envelope) + '\n');
    return;
  }
  if (opts.renderHuman) opts.renderHuman();
}

function buildSuccess<T>(data: T, opts: PrintOptions): SuccessEnvelope<T> {
  const out: { -readonly [K in keyof SuccessEnvelope<T>]: SuccessEnvelope<T>[K] } = {
    ok: true,
    data,
  };
  if (opts.meta !== undefined) out.meta = opts.meta;
  if (opts.hint !== undefined) out.hint = opts.hint;
  return out;
}

/**
 * Serialize an error for stdout in JSON mode. In human mode this is a no-op —
 * the caller is expected to print to stderr (cli.ts handleError does that).
 *
 * Returns true if anything was written to stdout (i.e. JSON mode was active).
 */
export function printError(err: unknown, opts: { readonly json?: boolean } = {}): boolean {
  if (!isJsonMode(opts)) return false;
  const envelope: ErrorEnvelope = toErrorEnvelope(err);
  process.stdout.write(JSON.stringify(envelope) + '\n');
  return true;
}

export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (isAtlasError(err)) {
    return { ok: false, ...err.serialize() };
  }
  if (err instanceof Error) {
    return {
      ok: false,
      code: 'CONFIG_ERROR',
      message: err.message,
    };
  }
  return {
    ok: false,
    code: 'CONFIG_ERROR',
    message: String(err),
  };
}
