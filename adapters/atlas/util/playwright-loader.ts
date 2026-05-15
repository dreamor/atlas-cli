import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Lazy-load `playwright` so commands that don't need it (e.g. `list`,
 * `month`, `summary`) can run from a Bun-compiled single binary without
 * the playwright package being present at runtime.
 *
 * Resolution order:
 *   1. Default module resolution (npm install in the project directory).
 *   2. `$ATLAS_HOME/lib/node_modules/playwright` (installed by bootstrap.sh).
 *
 * Throws a friendly error explaining how to recover when both fail.
 */
export async function loadPlaywright(commandName: string): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch (primaryErr) {
    const atlasHome = process.env.ATLAS_HOME ?? join(homedir(), '.atlas');
    const vendored = resolve(atlasHome, 'lib/node_modules/playwright');
    if (existsSync(vendored)) {
      try {
        return (await import(vendored)) as typeof import('playwright');
      } catch (fallbackErr) {
        throwFriendly(commandName, fallbackErr ?? primaryErr, vendored);
      }
    }
    throwFriendly(commandName, primaryErr, null);
  }
}

function throwFriendly(commandName: string, err: unknown, attemptedPath: string | null): never {
  const cause = err instanceof Error ? err.message : String(err);
  const lines = [
    `\`${commandName}\` requires the \`playwright\` package, which is not available.`,
    `Recovery options:`,
    `  1. Run the bootstrap installer: bash scripts/bootstrap.sh`,
    `     (or:  curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.sh | bash)`,
    `  2. Or install manually in a Node project: npm install playwright && npx playwright install chromium`,
  ];
  if (attemptedPath) {
    lines.push(`Tried: ${attemptedPath}`);
  }
  lines.push(`Underlying error: ${cause}`);
  throw new Error(lines.join('\n'));
}
