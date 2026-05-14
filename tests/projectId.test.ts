import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveProjectId } from '../adapters/atlas/util/projectId.js';
import { ConfigError } from '../adapters/atlas/util/errors.js';

describe('resolveProjectId', () => {
  const original = process.env.BANMA_PROJECT_ID;
  beforeEach(() => {
    delete process.env.BANMA_PROJECT_ID;
  });
  afterEach(() => {
    if (original !== undefined) process.env.BANMA_PROJECT_ID = original;
  });

  it('returns CLI flag when given', () => {
    expect(resolveProjectId('2548')).toBe('2548');
  });

  it('falls back to env var', () => {
    process.env.BANMA_PROJECT_ID = '999';
    expect(resolveProjectId(undefined)).toBe('999');
  });

  it('CLI flag wins over env', () => {
    process.env.BANMA_PROJECT_ID = '999';
    expect(resolveProjectId('2548')).toBe('2548');
  });

  it('throws when missing', () => {
    expect(() => resolveProjectId(undefined)).toThrow(ConfigError);
  });

  it('throws on non-numeric', () => {
    expect(() => resolveProjectId('abc')).toThrow(ConfigError);
  });
});
