import { runLogin, loadSession } from '../auth/index.js';

export async function authLoginCmd(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Launching headed Playwright for Banma SSO...');
  const result = await runLogin({});
  // eslint-disable-next-line no-console
  console.log(
    `Logged in as ${result.session.account} (empId=${result.session.empId}). Session saved via ${result.via}.`,
  );
}

export async function authStatusCmd(opts: { json?: boolean }): Promise<void> {
  const session = await loadSession();
  if (!session) {
    if (opts.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ authenticated: false }));
    } else {
      // eslint-disable-next-line no-console
      console.log('Not authenticated. Run `atlas auth login`.');
    }
    process.exitCode = 1;
    return;
  }
  const summary = {
    authenticated: true,
    account: session.account,
    empId: session.empId,
    cookies: session.cookies.length,
    savedAt: session.savedAt,
  };
  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `Authenticated as ${summary.account} (empId=${summary.empId}). ` +
      `${summary.cookies} cookies. Saved at ${summary.savedAt}.`,
  );
}
