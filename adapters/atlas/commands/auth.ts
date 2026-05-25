import { runLogin, loadSession } from '../auth/index.js';
import { printResult, isJsonMode } from '../util/output.js';

export async function authLoginCmd(): Promise<void> {
  if (!isJsonMode()) {
    // eslint-disable-next-line no-console
    console.log('Launching headed Playwright for Banma SSO...');
  }
  const result = await runLogin({});
  printResult(
    {
      account: result.session.account,
      empId: result.session.empId,
      via: result.via,
    },
    {
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(
          `Logged in as ${result.session.account} (empId=${result.session.empId}). Session saved via ${result.via}.`,
        );
      },
    },
  );
}

export async function authStatusCmd(opts: { json?: boolean }): Promise<void> {
  const session = await loadSession();
  if (!session) {
    printResult(
      { authenticated: false },
      {
        json: opts.json,
        hint: 'Run `atlas auth login`.',
        renderHuman: () => {
          // eslint-disable-next-line no-console
          console.log('Not authenticated. Run `atlas auth login`.');
        },
      },
    );
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
  printResult(summary, {
    json: opts.json,
    renderHuman: () => {
      // eslint-disable-next-line no-console
      console.log(
        `Authenticated as ${summary.account} (empId=${summary.empId}). ` +
          `${summary.cookies} cookies. Saved at ${summary.savedAt}.`,
      );
    },
  });
}
