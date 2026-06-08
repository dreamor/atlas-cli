import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  clearLink,
  linkFilePath,
  readLink,
  writeLink,
} from '../adapters/atlas/util/link.js';
import { resolveProjectIdAsync } from '../adapters/atlas/util/projectId.js';
import { ConfigError } from '../adapters/atlas/util/errors.js';
import type { BanmaClient } from '../adapters/atlas/http/client.js';

describe('link persistence', () => {
  const originalHome = process.env.HOME;
  const originalProject = process.env.BANMA_PROJECT_ID;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-link-'));
    process.env.HOME = tmp;
    delete process.env.BANMA_PROJECT_ID;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalProject !== undefined) process.env.BANMA_PROJECT_ID = originalProject;
    await rm(tmp, { recursive: true, force: true });
  });

  it('linkFilePath resolves under $HOME/.config/atlas', () => {
    expect(linkFilePath()).toBe(resolve(tmp, '.config', 'atlas', 'link.json'));
  });

  it('readLink returns null when no link file exists', async () => {
    expect(await readLink()).toBeNull();
  });

  it('writeLink creates the file and readLink round-trips', async () => {
    await writeLink({
      projectId: '2548',
      projectName: 'BMW IPA LLM 0726 项目',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
    const link = await readLink();
    expect(link).toEqual({
      projectId: '2548',
      projectName: 'BMW IPA LLM 0726 项目',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
  });

  it('writeLink without projectName omits the field on read', async () => {
    await writeLink({
      projectId: '777',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
    const link = await readLink();
    expect(link).toEqual({
      projectId: '777',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
  });

  it('writeLink overwrites a prior link', async () => {
    await writeLink({ projectId: '111', linkedAt: '2026-01-01T00:00:00.000Z' });
    await writeLink({ projectId: '222', linkedAt: '2026-02-02T00:00:00.000Z' });
    const link = await readLink();
    expect(link?.projectId).toBe('222');
  });

  it('readLink returns null when file is invalid JSON', async () => {
    await mkdir(join(tmp, '.config', 'atlas'), { recursive: true });
    await writeFile(linkFilePath(), 'not-json');
    expect(await readLink()).toBeNull();
  });

  it('readLink returns null when projectId is missing', async () => {
    await mkdir(join(tmp, '.config', 'atlas'), { recursive: true });
    await writeFile(linkFilePath(), JSON.stringify({ linkedAt: 'x' }));
    expect(await readLink()).toBeNull();
  });

  it('clearLink removes existing file and returns true', async () => {
    await writeLink({ projectId: '333', linkedAt: '2026-01-01T00:00:00.000Z' });
    const removed = await clearLink();
    expect(removed).toBe(true);
    await expect(access(linkFilePath())).rejects.toThrow();
    expect(await readLink()).toBeNull();
  });

  it('clearLink returns false when nothing to remove', async () => {
    expect(await clearLink()).toBe(false);
  });
});

describe('resolveProjectIdAsync link fallback', () => {
  const originalHome = process.env.HOME;
  const originalProject = process.env.BANMA_PROJECT_ID;
  let tmp: string;

  // Catalog only used for non-numeric paths; numeric short-circuits before fetch.
  const stubClient = {} as BanmaClient;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-link-resolve-'));
    process.env.HOME = tmp;
    delete process.env.BANMA_PROJECT_ID;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalProject !== undefined) process.env.BANMA_PROJECT_ID = originalProject;
    await rm(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('falls back to link when no flag/env is set', async () => {
    await writeLink({
      projectId: '2548',
      projectName: 'BMW IPA LLM 0726 项目',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
    const r = await resolveProjectIdAsync(undefined, stubClient);
    expect(r.id).toBe('2548');
    expect(r.name).toBe('BMW IPA LLM 0726 项目');
    expect(r.fromLink).toBe(true);
  });

  it('CLI flag overrides link', async () => {
    await writeLink({ projectId: '2548', linkedAt: '2026-06-06T00:00:00.000Z' });
    const r = await resolveProjectIdAsync('999', stubClient);
    expect(r.id).toBe('999');
    expect(r.fromLink).toBeUndefined();
  });

  it('env var overrides link', async () => {
    await writeLink({ projectId: '2548', linkedAt: '2026-06-06T00:00:00.000Z' });
    process.env.BANMA_PROJECT_ID = '888';
    const r = await resolveProjectIdAsync(undefined, stubClient);
    expect(r.id).toBe('888');
    expect(r.fromLink).toBeUndefined();
  });

  it('throws when no flag, env, or link is present', async () => {
    await expect(resolveProjectIdAsync(undefined, stubClient)).rejects.toThrow(
      ConfigError,
    );
  });

  it('error mentions link in the hint when nothing resolves', async () => {
    try {
      await resolveProjectIdAsync(undefined, stubClient);
      expect.fail('expected ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain('atlas link');
    }
  });
});
