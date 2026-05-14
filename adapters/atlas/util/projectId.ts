import { ConfigError } from './errors.js';
import {
  loadProjectCatalog,
  resolveProjectIdFromName,
} from '../dict/projectCatalog.js';
import type { BanmaClient } from '../http/client.js';

export interface ResolvedProjectId {
  readonly id: string;
  readonly name?: string;
}

/**
 * Sync resolution: only accepts numeric ids (or numeric env var).
 * Use {@link resolveProjectIdAsync} when callers should also accept Chinese
 * names / substrings (everything except numeric).
 */
export function resolveProjectId(cliFlag: string | undefined): string {
  const raw = cliFlag ?? process.env.BANMA_PROJECT_ID ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ConfigError(
      '--project-id is required (or set BANMA_PROJECT_ID env var).',
    );
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new ConfigError(`--project-id must be numeric, got "${trimmed}".`);
  }
  return trimmed;
}

/**
 * Resolve `--project-id` accepting either a numeric id or a project name
 * (exact case-insensitive or unique substring). When the input is purely
 * numeric we skip the catalog fetch entirely.
 */
export async function resolveProjectIdAsync(
  cliFlag: string | undefined,
  client: BanmaClient,
  opts: { refresh?: boolean } = {},
): Promise<ResolvedProjectId> {
  const raw = cliFlag ?? process.env.BANMA_PROJECT_ID ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ConfigError(
      '--project-id is required (or set BANMA_PROJECT_ID env var).',
    );
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return { id: trimmed };
  }

  const catalog = await loadProjectCatalog(client, opts);
  const result = resolveProjectIdFromName(catalog, trimmed);

  if (result.kind === 'resolved') {
    return { id: result.project.id, name: result.project.name };
  }

  if (result.kind === 'ambiguous') {
    const lines = result.matches.map((m) => `  ${m.id}  ${m.name}`).join('\n');
    throw new ConfigError(
      `--project-id "${trimmed}" matched ${result.matches.length} projects. ` +
        `Pass a more specific name or the numeric id:\n${lines}`,
    );
  }

  throw new ConfigError(
    `--project-id "${trimmed}" did not match any project name or id. ` +
      'Try `--refresh-projects` to refetch the catalog.',
  );
}
