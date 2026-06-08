/**
 * Project link persistence.
 *
 * Stores the "currently linked" project so commands like `list`, `show`,
 * `month`, etc. can omit `--project-id`. Lives at ~/.config/atlas/link.json
 * (one entry, overwritten on each `atlas link <project>`).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export interface ProjectLink {
  readonly projectId: string;
  readonly projectName?: string;
  readonly linkedAt: string;
}

/**
 * Resolved at call time so tests can override HOME after import.
 * Mirrors the late-binding pattern in util/undo.ts.
 */
export function linkFilePath(): string {
  return resolve(homedir(), '.config', 'atlas', 'link.json');
}

/**
 * Read the current project link, or null when no project is linked.
 * Silently returns null on any read/parse error — the link file is
 * advisory state, never a hard dependency.
 */
export async function readLink(): Promise<ProjectLink | null> {
  try {
    const raw = await readFile(linkFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectLink>;
    if (typeof parsed.projectId !== 'string' || parsed.projectId.length === 0) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      ...(typeof parsed.projectName === 'string' ? { projectName: parsed.projectName } : {}),
      linkedAt: typeof parsed.linkedAt === 'string' ? parsed.linkedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function writeLink(link: ProjectLink): Promise<void> {
  const target = linkFilePath();
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify(link, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Remove the link file. Returns true when a link existed, false when
 * there was nothing to clear.
 */
export async function clearLink(): Promise<boolean> {
  try {
    await rm(linkFilePath(), { force: false });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
