import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isJsonMode,
  printError,
  printResult,
  toErrorEnvelope,
} from '../adapters/atlas/util/output.js';
import {
  BanmaApiError,
  ConfigError,
  NotImplementedError,
  SessionExpiredError,
} from '../adapters/atlas/util/errors.js';

describe('output: isJsonMode', () => {
  const originalOutput = process.env.ATLAS_OUTPUT;
  const originalJson = process.env.ATLAS_JSON;

  beforeEach(() => {
    delete process.env.ATLAS_OUTPUT;
    delete process.env.ATLAS_JSON;
  });
  afterEach(() => {
    if (originalOutput === undefined) delete process.env.ATLAS_OUTPUT;
    else process.env.ATLAS_OUTPUT = originalOutput;
    if (originalJson === undefined) delete process.env.ATLAS_JSON;
    else process.env.ATLAS_JSON = originalJson;
  });

  it('returns false by default', () => {
    expect(isJsonMode()).toBe(false);
  });

  it('returns true when --json flag is set', () => {
    expect(isJsonMode({ json: true })).toBe(true);
  });

  it('returns true when ATLAS_OUTPUT=json', () => {
    process.env.ATLAS_OUTPUT = 'json';
    expect(isJsonMode()).toBe(true);
  });

  it('returns true when ATLAS_OUTPUT=JSON (case-insensitive)', () => {
    process.env.ATLAS_OUTPUT = 'JSON';
    expect(isJsonMode()).toBe(true);
  });

  it('returns true when ATLAS_JSON=1', () => {
    process.env.ATLAS_JSON = '1';
    expect(isJsonMode()).toBe(true);
  });

  it('ignores ATLAS_OUTPUT=text', () => {
    process.env.ATLAS_OUTPUT = 'text';
    expect(isJsonMode()).toBe(false);
  });
});

describe('output: toErrorEnvelope', () => {
  it('serialises SessionExpiredError', () => {
    const env = toErrorEnvelope(new SessionExpiredError('test reason'));
    expect(env.ok).toBe(false);
    expect(env.code).toBe('SESSION_EXPIRED');
    expect(env.message).toContain('test reason');
    expect(env.hint).toBe('Run `atlas auth login` to re-authenticate.');
  });

  it('serialises BanmaApiError with details', () => {
    const env = toErrorEnvelope(
      new BanmaApiError({
        errCode: 'EXPIRED',
        errorMsg: 'token expired',
        httpStatus: 401,
        path: '/api/x',
      }),
    );
    expect(env.code).toBe('API_ERROR');
    expect(env.details).toMatchObject({
      errCode: 'EXPIRED',
      httpStatus: 401,
      path: '/api/x',
    });
  });

  it('serialises ConfigError with overrideable code + details (ambiguous project)', () => {
    const err = new ConfigError('matched 3', {
      code: 'AMBIGUOUS_PROJECT',
      hint: 'pick one',
      details: { candidates: [{ id: '1', name: 'A' }] },
    });
    const env = toErrorEnvelope(err);
    expect(env.code).toBe('AMBIGUOUS_PROJECT');
    expect(env.hint).toBe('pick one');
    expect(env.details).toEqual({ candidates: [{ id: '1', name: 'A' }] });
  });

  it('serialises NotImplementedError', () => {
    expect(toErrorEnvelope(new NotImplementedError('soon')).code).toBe('NOT_IMPLEMENTED');
  });

  it('serialises plain Error as CONFIG_ERROR', () => {
    expect(toErrorEnvelope(new Error('boom')).code).toBe('CONFIG_ERROR');
  });

  it('serialises non-Error throwables', () => {
    expect(toErrorEnvelope('string error').message).toBe('string error');
  });
});

describe('output: printResult and printError stdout writes', () => {
  const originalOutput = process.env.ATLAS_OUTPUT;
  const stdoutWriteOriginal = process.stdout.write.bind(process.stdout);
  let writes: string[];
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writes = [];
    writeSpy = vi.fn((chunk: unknown) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write;
  });
  afterEach(() => {
    process.stdout.write = stdoutWriteOriginal;
    if (originalOutput === undefined) delete process.env.ATLAS_OUTPUT;
    else process.env.ATLAS_OUTPUT = originalOutput;
  });

  it('printResult emits success envelope in JSON mode', () => {
    printResult({ x: 1 }, { json: true, meta: { count: 1 }, hint: 'try this' });
    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed).toEqual({
      ok: true,
      data: { x: 1 },
      meta: { count: 1 },
      hint: 'try this',
    });
  });

  it('printResult does NOT write to stdout in human mode', () => {
    let humanCalled = false;
    printResult({ x: 1 }, {
      renderHuman: () => {
        humanCalled = true;
      },
    });
    expect(writes.length).toBe(0);
    expect(humanCalled).toBe(true);
  });

  it('printError writes envelope and returns true in JSON mode', () => {
    delete process.env.ATLAS_OUTPUT;
    const wrote = printError(new SessionExpiredError(), { json: true });
    expect(wrote).toBe(true);
    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('SESSION_EXPIRED');
  });

  it('printError returns false (no stdout) in human mode', () => {
    const wrote = printError(new SessionExpiredError());
    expect(wrote).toBe(false);
    expect(writes.length).toBe(0);
  });
});
