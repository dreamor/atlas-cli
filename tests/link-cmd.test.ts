import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLink, writeLink } from '../adapters/atlas/util/link.js';

// ---------------------------------------------------------------------------
// Mocks — factory functions must not reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('../adapters/atlas/commands/_client.js', () => ({
  getClientOrExit: vi.fn().mockResolvedValue({
    request: vi.fn().mockResolvedValue({
      envelope: { success: true },
      data: [
        { id: '2548', name: 'BMW IPA LLM 0726 项目' },
        { id: '9999', name: '其他项目' },
      ],
    }),
    rawJson: vi.fn(),
  }),
}));

vi.mock('../adapters/atlas/dict/projectCatalog.js', () => ({
  loadProjectCatalog: vi.fn().mockResolvedValue([
    { id: '2548', name: 'BMW IPA LLM 0726 项目' },
    { id: '9999', name: '其他项目' },
  ]),
  resolveProjectIdFromName: vi.fn().mockReturnValue({
    kind: 'resolved',
    project: { id: '2548', name: 'BMW IPA LLM 0726 项目' },
  }),
}));

vi.mock('../adapters/atlas/auth/session.js', () => ({
  loadSession: vi.fn().mockResolvedValue({
    account: 'test@alibaba.com',
    empId: '527449',
    bucToken: 'fake-token',
    cookies: 'fake=1',
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { linkCmd, unlinkCmd, linkStatusCmd } from '../adapters/atlas/commands/link.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture console.log output during a callback. */
async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return chunks.join('\n');
}

/** Capture process.stdout.write (JSON mode) during a callback. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === 'string') chunks.push(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('linkCmd', () => {
  const originalHome = process.env.HOME;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-link-cmd-'));
    process.env.HOME = tmp;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.ATLAS_OUTPUT;
    delete process.env.ATLAS_JSON;
    await rm(tmp, { recursive: true, force: true });
  });

  it('links a project by numeric id and persists', async () => {
    const out = await captureConsole(() =>
      linkCmd('2548', { json: false }),
    );

    expect(out).toContain('2548');
    const link = await readLink();
    expect(link).not.toBeNull();
    expect(link!.projectId).toBe('2548');
  });

  it('links a project in JSON mode', async () => {
    const out = await captureStdout(() =>
      linkCmd('2548', { json: true }),
    );

    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.projectId).toBe('2548');
  });

  it('overwrites a previous link', async () => {
    await writeLink({ projectId: '111', linkedAt: '2026-01-01T00:00:00.000Z' });
    await captureConsole(() =>
      linkCmd('2548', { json: false }),
    );
    const link = await readLink();
    expect(link!.projectId).toBe('2548');
  });
});

describe('unlinkCmd', () => {
  const originalHome = process.env.HOME;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-unlink-cmd-'));
    process.env.HOME = tmp;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.ATLAS_OUTPUT;
    delete process.env.ATLAS_JSON;
    await rm(tmp, { recursive: true, force: true });
  });

  it('unlinks a project and reports removal', async () => {
    await writeLink({ projectId: '2548', linkedAt: '2026-06-06T00:00:00.000Z' });
    const out = await captureConsole(() => unlinkCmd({ json: false }));
    expect(out).toContain('Unlinked');
    const link = await readLink();
    expect(link).toBeNull();
  });

  it('reports no link when nothing to unlink', async () => {
    const out = await captureConsole(() => unlinkCmd({ json: false }));
    expect(out).toContain('No project was linked');
  });

  it('outputs JSON when unlinking', async () => {
    await writeLink({ projectId: '2548', linkedAt: '2026-06-06T00:00:00.000Z' });
    const out = await captureStdout(() => unlinkCmd({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.removed).toBe(true);
    expect(parsed.data.previous.projectId).toBe('2548');
  });
});

describe('linkStatusCmd', () => {
  const originalHome = process.env.HOME;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'atlas-link-status-'));
    process.env.HOME = tmp;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.ATLAS_OUTPUT;
    delete process.env.ATLAS_JSON;
    await rm(tmp, { recursive: true, force: true });
  });

  it('shows no link when nothing is linked', async () => {
    const out = await captureConsole(() => linkStatusCmd({ json: false }));
    expect(out).toContain('No project linked');
  });

  it('shows the linked project when one exists', async () => {
    await writeLink({
      projectId: '2548',
      projectName: 'BMW IPA LLM 0726 项目',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
    const out = await captureConsole(() => linkStatusCmd({ json: false }));
    expect(out).toContain('2548');
  });

  it('outputs JSON when linked', async () => {
    await writeLink({
      projectId: '2548',
      projectName: 'BMW IPA LLM 0726 项目',
      linkedAt: '2026-06-06T00:00:00.000Z',
    });
    const out = await captureStdout(() => linkStatusCmd({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.linked).toBe(true);
    expect(parsed.data.projectId).toBe('2548');
  });

  it('outputs JSON when not linked', async () => {
    const out = await captureStdout(() => linkStatusCmd({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.linked).toBe(false);
  });
});
