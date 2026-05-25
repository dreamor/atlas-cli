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
      .command('list')
      .description('列出条目')
      .option('--project-id <id>', '项目 ID')
      .option('--json', '输出 JSON');
    program
      .command('month')
      .description('按月汇总')
      .option('--from <yyyymm>', '起始月份')
      .option('--to <yyyymm>', '结束月份');

    const out = captureStdout(() => {
      schemaCommandsCmd(program, { json: true });
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.commands).toHaveLength(2);

    const list = parsed.data.commands.find((c: { path: string }) => c.path === 'atlas list');
    expect(list.description).toBe('列出条目');
    expect(list.options.map((o: { flags: string }) => o.flags)).toEqual(
      expect.arrayContaining(['--project-id <id>', '--json']),
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
    program.command('show <itemId>').description('显示').option('--json', 'json');

    const out = captureStdout(() => {
      schemaCommandsCmd(program, { json: true });
    });
    const parsed = JSON.parse(out);
    const show = parsed.data.commands.find((c: { path: string }) => c.path === 'atlas show');
    expect(show.args).toEqual([{ name: 'itemId', required: true }]);
  });
});
