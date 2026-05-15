import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const INSTALL_TIMEOUT_MS = 30_000;
const INSTALLER_BASE = 'https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts';

/**
 * Lazy-load `playwright` so commands that don't need it (e.g. `list`,
 * `month`, `summary`) can run from a Bun-compiled single binary without
 * the playwright package being present at runtime.
 *
 * Resolution order:
 *   1. Default module resolution (npm install in the project directory).
 *   2. `$ATLAS_HOME/lib/node_modules/playwright` (installed by bootstrap.sh).
 *   3. Optional auto-bootstrap: spawn install.sh / install.ps1 to install
 *      everything, then retry.
 *
 * Auto-bootstrap behavior:
 *   - `ATLAS_AUTO_BOOTSTRAP=1`: skip prompt, install immediately.
 *   - TTY interactive: prompt the user (default no, 30s timeout).
 *   - Non-TTY without env var: skip auto-bootstrap, throw friendly error.
 */
export async function loadPlaywright(commandName: string): Promise<typeof import('playwright')> {
  const atlasHome = process.env.ATLAS_HOME ?? join(homedir(), '.atlas');
  const vendored = resolve(atlasHome, 'lib/node_modules/playwright');

  try {
    return await import('playwright');
  } catch (primaryErr) {
    if (existsSync(vendored)) {
      try {
        return (await import(vendored)) as typeof import('playwright');
      } catch {
        // fall through
      }
    }

    const bootstrapped = await tryAutoBootstrap(commandName, atlasHome, vendored);
    if (bootstrapped) return bootstrapped;

    throwFriendly(commandName, primaryErr, existsSync(vendored) ? vendored : null);
  }
}

async function tryAutoBootstrap(
  commandName: string,
  atlasHome: string,
  vendored: string,
): Promise<typeof import('playwright') | null> {
  const consented = await getConsent(commandName);
  if (!consented) return null;

  const isWin = process.platform === 'win32';
  const installerUrl = `${INSTALLER_BASE}/${isWin ? 'install.ps1' : 'install.sh'}`;

  const command = isWin ? 'powershell' : 'bash';
  const args = isWin
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `iwr -useb ${installerUrl} | iex`]
    : ['-c', `curl -fsSL ${installerUrl} | bash`];

  // eslint-disable-next-line no-console
  console.error(`\n[atlas] Running installer: ${installerUrl}\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ATLAS_HOME: atlasHome, ATLAS_BOOTSTRAP_YES: '1' },
  });

  if (result.status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`[atlas] Installer exited with status ${result.status ?? 'unknown'}`);
    return null;
  }

  if (!existsSync(vendored)) return null;
  try {
    return (await import(vendored)) as typeof import('playwright');
  } catch {
    return null;
  }
}

async function getConsent(commandName: string): Promise<boolean> {
  if (process.env.ATLAS_AUTO_BOOTSTRAP === '1') return true;
  if (process.stdin.isTTY !== true) return false;

  const prompt =
    `\n[atlas] \`${commandName}\` requires playwright + chromium (~80MB).\n` +
    `[atlas] Run the installer now? [y/N] `;

  return new Promise((resolveAns) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const timer = setTimeout(() => {
      rl.close();
      resolveAns(false);
    }, INSTALL_TIMEOUT_MS);

    rl.question(prompt, (answer) => {
      clearTimeout(timer);
      rl.close();
      resolveAns(/^[yY]/.test(answer.trim()));
    });
  });
}

function throwFriendly(commandName: string, err: unknown, attemptedPath: string | null): never {
  const cause = err instanceof Error ? err.message : String(err);
  const lines = [
    `\`${commandName}\` requires the \`playwright\` package, which is not available.`,
    `Recovery options:`,
    `  1. Run the bootstrap installer: bash scripts/bootstrap.sh`,
    `     (or:  curl -fsSL ${INSTALLER_BASE}/install.sh | bash)`,
    `  2. Or install manually in a Node project: npm install playwright && npx playwright install chromium`,
    `  3. Or set ATLAS_AUTO_BOOTSTRAP=1 to auto-install on next run`,
  ];
  if (attemptedPath) {
    lines.push(`Tried: ${attemptedPath}`);
  }
  lines.push(`Underlying error: ${cause}`);
  throw new Error(lines.join('\n'));
}
