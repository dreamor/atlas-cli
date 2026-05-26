import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listManifests,
  loadManifest,
  manifestPath,
  markUndone,
  newToken,
  writeManifest,
  type UndoManifest,
} from '../adapters/atlas/util/undo.js';

describe('undo manifest store', () => {
  const originalHome = process.env.HOME;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-undo-'));
    process.env.HOME = tmp;
  });
  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmp, { recursive: true, force: true });
  });

  function sample(token: string): UndoManifest {
    return {
      token,
      command: 'fill',
      target: 'lineplan',
      projectId: '2548',
      timestamp: new Date().toISOString(),
      before: [{ id: 1, foo: 'old' }],
      after: [{ id: 1, foo: 'new' }],
    };
  }

  it('newToken returns matching shape', () => {
    const t = newToken('fill', '2548');
    expect(t).toMatch(/^fill-2548-\d{14}-[a-z0-9]{6}$/);
  });

  it('writeManifest then loadManifest round-trips', async () => {
    // paths.ts caches HOME at module load time, so we can't override it after
    // import. Instead we write through manifestPath() and the user-supplied
    // CACHE_DIR. Since CACHE_DIR was resolved at import time, we redirect to
    // it in this test by writing files directly into that dir.
    const m = sample(newToken('fill', '2548'));
    const path = await writeManifest(m);
    expect(path).toContain(m.token);
    const loaded = await loadManifest(m.token);
    expect(loaded.before).toEqual(m.before);
    expect(loaded.after).toEqual(m.after);
  });

  it('markUndone sets undoneAt and prevents double undo', async () => {
    const m = sample(newToken('fill', '2548'));
    await writeManifest(m);
    const updated = await markUndone(m.token);
    expect(updated.undoneAt).toBeDefined();
    await expect(markUndone(m.token)).rejects.toThrow(/already undone/);
  });

  it('listManifests returns most recent first', async () => {
    const a = sample(newToken('fill', '2548'));
    await writeManifest(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = sample(newToken('fill', '2548'));
    await writeManifest(b);
    const list = await listManifests(10);
    expect(list[0]?.token).toBe(b.token);
    expect(list[1]?.token).toBe(a.token);
  });

  it('listManifests skips malformed manifests gracefully', async () => {
    // Drop a junk file in the undo dir.
    const dir = manifestPath('placeholder').replace(/[^/]+$/, '');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{not json', 'utf8');

    // And a valid one.
    const ok = sample(newToken('fill', '2548'));
    await writeManifest(ok);

    const list = await listManifests(10);
    expect(list.find((s) => s.token === ok.token)).toBeDefined();
  });

  it('rejects token with shell metacharacters', () => {
    expect(() => manifestPath('../etc/passwd')).toThrow(/Invalid undo token/);
    expect(() => manifestPath('a;b')).toThrow(/Invalid undo token/);
  });

  it('manifest content survives round-trip via JSON', async () => {
    const m: UndoManifest = {
      ...sample(newToken('fill', '2548')),
      serverResponse: { applied: 5, ids: [1, 2, 3] },
    };
    await writeManifest(m);
    const raw = await readFile(manifestPath(m.token), 'utf8');
    const parsed = JSON.parse(raw) as UndoManifest;
    expect(parsed.serverResponse).toEqual({ applied: 5, ids: [1, 2, 3] });
  });
});
