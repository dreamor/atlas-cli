/**
 * Atlas CLI error classes.
 *
 * Each class carries:
 *   - `code`: stable string identifier suitable for agent / skill consumption.
 *     Mapped 1:1 to a process exit code by handleError() in cli.ts.
 *   - `details`: optional structured payload (e.g. candidate projects, server
 *     response). The JSON envelope writer serialises this verbatim alongside
 *     `code` and `message`.
 *
 * NOTE: do NOT rename or reshape `code` values without bumping the CLI's
 * agent-facing contract version. Skills key off these strings.
 */

export type AtlasErrorCode =
  | 'SESSION_EXPIRED'
  | 'API_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'CONFIG_ERROR'
  | 'AMBIGUOUS_PROJECT'
  | 'PROJECT_NOT_FOUND';

export interface AtlasErrorDetails {
  readonly [key: string]: unknown;
}

export interface SerializedAtlasError {
  readonly code: AtlasErrorCode;
  readonly message: string;
  readonly hint?: string;
  readonly details?: AtlasErrorDetails;
}

export interface AtlasError extends Error {
  readonly code: AtlasErrorCode;
  readonly hint?: string;
  readonly details?: AtlasErrorDetails;
  serialize(): SerializedAtlasError;
}

function makeSerialize(
  code: AtlasErrorCode,
  message: string,
  hint: string | undefined,
  details: AtlasErrorDetails | undefined,
): SerializedAtlasError {
  const out: { -readonly [K in keyof SerializedAtlasError]: SerializedAtlasError[K] } = {
    code,
    message,
  };
  if (hint !== undefined) out.hint = hint;
  if (details !== undefined) out.details = details;
  return out;
}

export class BanmaApiError extends Error implements AtlasError {
  readonly code: AtlasErrorCode = 'API_ERROR';
  readonly errCode: string;
  readonly errorMsg: string;
  readonly httpStatus?: number;
  readonly path?: string;
  readonly hint?: string;
  readonly details?: AtlasErrorDetails;

  constructor(opts: {
    readonly errCode: string;
    readonly errorMsg: string;
    readonly httpStatus?: number;
    readonly path?: string;
    readonly hint?: string;
  }) {
    super(`[banma:${opts.errCode}] ${opts.errorMsg}`);
    this.name = 'BanmaApiError';
    this.errCode = opts.errCode;
    this.errorMsg = opts.errorMsg;
    if (opts.httpStatus !== undefined) this.httpStatus = opts.httpStatus;
    if (opts.path !== undefined) this.path = opts.path;
    if (opts.hint !== undefined) this.hint = opts.hint;
    this.details = {
      errCode: opts.errCode,
      ...(opts.httpStatus !== undefined ? { httpStatus: opts.httpStatus } : {}),
      ...(opts.path !== undefined ? { path: opts.path } : {}),
    };
  }

  serialize(): SerializedAtlasError {
    return makeSerialize(this.code, this.message, this.hint, this.details);
  }
}

export class SessionExpiredError extends Error implements AtlasError {
  readonly code: AtlasErrorCode = 'SESSION_EXPIRED';
  readonly hint = 'Run `atlas auth login` to re-authenticate.';
  readonly details?: AtlasErrorDetails;

  constructor(reason = 'BUC session expired') {
    super(`${reason}. Run \`atlas auth login\` to re-authenticate.`);
    this.name = 'SessionExpiredError';
  }

  serialize(): SerializedAtlasError {
    return makeSerialize(this.code, this.message, this.hint, this.details);
  }
}

export class NotImplementedError extends Error implements AtlasError {
  readonly code: AtlasErrorCode = 'NOT_IMPLEMENTED';
  readonly hint?: string;
  readonly details?: AtlasErrorDetails;

  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }

  serialize(): SerializedAtlasError {
    return makeSerialize(this.code, this.message, this.hint, this.details);
  }
}

export class ConfigError extends Error implements AtlasError {
  readonly code: AtlasErrorCode;
  readonly hint?: string;
  readonly details?: AtlasErrorDetails;

  constructor(
    message: string,
    opts: {
      readonly code?: AtlasErrorCode;
      readonly hint?: string;
      readonly details?: AtlasErrorDetails;
    } = {},
  ) {
    super(message);
    this.name = 'ConfigError';
    this.code = opts.code ?? 'CONFIG_ERROR';
    if (opts.hint !== undefined) this.hint = opts.hint;
    if (opts.details !== undefined) this.details = opts.details;
  }

  serialize(): SerializedAtlasError {
    return makeSerialize(this.code, this.message, this.hint, this.details);
  }
}

export function isAtlasError(err: unknown): err is AtlasError {
  return (
    err instanceof BanmaApiError ||
    err instanceof SessionExpiredError ||
    err instanceof NotImplementedError ||
    err instanceof ConfigError
  );
}
