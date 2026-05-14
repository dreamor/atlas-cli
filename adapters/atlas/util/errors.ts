export class BanmaApiError extends Error {
  readonly errCode: string;
  readonly errorMsg: string;
  readonly httpStatus?: number;
  readonly path?: string;

  constructor(opts: {
    errCode: string;
    errorMsg: string;
    httpStatus?: number;
    path?: string;
  }) {
    super(`[banma:${opts.errCode}] ${opts.errorMsg}`);
    this.name = 'BanmaApiError';
    this.errCode = opts.errCode;
    this.errorMsg = opts.errorMsg;
    if (opts.httpStatus !== undefined) this.httpStatus = opts.httpStatus;
    if (opts.path !== undefined) this.path = opts.path;
  }
}

export class SessionExpiredError extends Error {
  constructor(reason = 'BUC session expired') {
    super(`${reason}. Run \`atlas auth login\` to re-authenticate.`);
    this.name = 'SessionExpiredError';
  }
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
