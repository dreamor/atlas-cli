import { describe, expect, it } from 'vitest';
import { Command } from 'commander';

// Re-import internal helpers we want to unit-test. These are not exported as
// they're command-internal — for tests we instead drive the public entry
// (schemaCommandsCmd) and inspect its envelope output via printResult.
import { schemaCommandsCmd } from '../adapters/atlas/commands/schema.js';

function captureStdout(fn: () => void): string {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = ((chunk: unknown) => {
    captured += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

describe('schema commands introspection', () => {
  it('emits one CommandEntry per registered subcommand with options', () => {
    const program = new Command();
    program.name('atlas').description('root');
    program
      .command('month')
      .description('按月汇总')
      .option('--from <yyyymm>', '起始月份')
      .option('--to <yyyymm>', '结束月份');
    program
      .command('export')
      .description('导出')
      .option('--format <fmt>', '格式')
      .option('--out <path>', '路径');

    const out = captureStdout(() => {
      schemaCommandsCmd(program, { json: true });
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.commands).toHaveLength(2);

    const month = parsed.data.commands.find((c: { path: string }) => c.path === 'atlas month');
    expect(month.description).toBe('按月汇总');
    expect(month.options.map((o: { flags: string }) => o.flags)).toEqual(
      expect.arrayContaining(['--from <yyyymm>', '--to <yyyymm>']),
    );
  });

  it('captures nested subcommands (auth login / status)', () => {
    const program = new Command();
    program.name('atlas');
    const auth = program.command('auth').description('SSO');
    auth.command('login').description('登录');
    auth.command('status').description('查看').option('--json', 'json');

    const out = captureStdout(() => {
      schemaCommandsCmd(program, { json: true });
    });
    const parsed = JSON.parse(out);
    const paths = parsed.data.commands.map((c: { path: string }) => c.path);
    expect(paths).toEqual(
      expect.arrayContaining(['atlas auth', 'atlas auth login', 'atlas auth status']),
    );
  });

  it('records argument names and required flag', () => {
    const program = new Command();
    program.name('atlas');
    program.command('exec <planFile>').description('批量执行').option('--json', 'json');

    const out = captureStdout(() => {
      schemaCommandsCmd(program, { json: true });
    });
    const parsed = JSON.parse(out);
    const exec = parsed.data.commands.find((c: { path: string }) => c.path === 'atlas exec');
    expect(exec.args).toEqual([{ name: 'planFile', required: true }]);
  });
});
