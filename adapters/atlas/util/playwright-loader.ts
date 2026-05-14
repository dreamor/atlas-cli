/**
 * Lazy-load `playwright` so commands that don't need it (e.g. `list`,
 * `month`, `summary`) can run from a Bun-compiled single binary without
 * the playwright package being present at runtime.
 *
 * Throws a friendly error explaining how to recover when playwright is
 * missing — typically the user is running the compiled binary in an
 * environment without `node_modules`.
 */
export async function loadPlaywright(commandName: string): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `\`${commandName}\` requires the \`playwright\` package, which is not available.\n` +
        `If you are running the compiled \`atlas\` binary, run this command in a directory ` +
        `with \`playwright\` installed (e.g. clone the repo and \`npm install\`), or use the ` +
        `Node-based entry: \`node ./dist/adapters/atlas/cli.js ${commandName}\`.\n` +
        `Underlying error: ${cause}`,
    );
  }
}
