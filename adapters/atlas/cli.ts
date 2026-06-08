#!/usr/bin/env node
import { Command } from 'commander';
import { authLoginCmd, authStatusCmd } from './commands/auth.js';
import { listCmd } from './commands/list.js';
import { showCmd } from './commands/show.js';
import { exportCmd } from './commands/export.js';
import { fillCmd } from './commands/fill.js';
import { importCmd } from './commands/import.js';
import { monthCmd } from './commands/month.js';
import { summaryCmd } from './commands/summary.js';
import { actualCmd } from './commands/actual.js';
import { daemonCmd } from './daemon/index.js';
import { resolveCmd } from './commands/resolve.js';
import { schemaCommandsCmd, schemaExportCmd } from './commands/schema.js';
import { undoCmd } from './commands/undo.js';
import { execCmd } from './commands/exec.js';
import { suggestCmd } from './commands/suggest.js';
import { linkCmd, linkStatusCmd, unlinkCmd } from './commands/link.js';
import {
  BanmaApiError,
  ConfigError,
  NotImplementedError,
  SessionExpiredError,
} from './util/errors.js';
import { isJsonMode, printError } from './util/output.js';

function handleError(err: unknown): never {
  // In JSON mode, route to stdout as a uniform envelope and exit with the
  // appropriate code. Human (stderr) text is suppressed.
  if (isJsonMode()) {
    printError(err, { json: true });
    process.exit(exitCodeFor(err));
  }
  if (err instanceof SessionExpiredError) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(2);
  }
  if (err instanceof ConfigError) {
    // eslint-disable-next-line no-console
    console.error(`Config error: ${err.message}`);
    process.exit(64);
  }
  if (err instanceof BanmaApiError) {
    // eslint-disable-next-line no-console
    console.error(`Banma API error [${err.errCode}] ${err.errorMsg}`);
    process.exit(3);
  }
  if (err instanceof NotImplementedError) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(64);
  }
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
}

function exitCodeFor(err: unknown): number {
  if (err instanceof SessionExpiredError) return 2;
  if (err instanceof BanmaApiError) return 3;
  if (err instanceof ConfigError) return 64;
  if (err instanceof NotImplementedError) return 64;
  return 1;
}

interface DescribeOptionEntry {
  flags: string;
  description: string;
  required: boolean;
  default?: unknown;
}

interface DescribeArgEntry {
  name: string;
  required: boolean;
}

interface DescribePayload {
  command: string;
  description: string;
  options: DescribeOptionEntry[];
  args: DescribeArgEntry[];
  subcommands: string[];
}

function emitDescribe(cmd: Command): void {
  const path: string[] = [];
  let cursor: Command | null = cmd;
  while (cursor && cursor.name() !== 'atlas') {
    path.unshift(cursor.name());
    cursor = cursor.parent;
  }
  const payload: DescribePayload = {
    command: ['atlas', ...path].join(' '),
    description: cmd.description() ?? '',
    options: cmd.options.map((o) => ({
      flags: o.flags,
      description: o.description ?? '',
      required: o.required ?? false,
      ...(o.defaultValue !== undefined ? { default: o.defaultValue } : {}),
    })),
    args:
      cmd.registeredArguments?.map((a) => ({
        name: a.name(),
        required: a.required,
      })) ?? [],
    subcommands: cmd.commands.map((c) => c.name()),
  };
  const envelope = { ok: true, data: payload };
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

function addProjectOptions(cmd: Command): Command {
  return cmd
    .option(
      '--project-id <id>',
      '项目ID，精确名称或唯一子串（或使用 BANMA_PROJECT_ID 环境变量）',
    )
    .option(
      '--refresh-projects',
      '解析 --project-id 前重新获取项目目录缓存',
    );
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('atlas')
    .description('Atlas CLI - 斑马云图人力基线管理工具')
    .option('--json', '以 JSON 信封输出（也可用环境变量 ATLAS_OUTPUT=json）')
    .option('--describe', '不执行命令，仅输出该命令的参数 schema（agent 自省用）')
    .showHelpAfterError()
    .hook('preAction', (thisCommand, actionCommand) => {
      // Propagate top-level --json down to ATLAS_OUTPUT so deep helpers can
      // see it without threading the flag through every call site.
      const opts = thisCommand.opts() as { json?: boolean; describe?: boolean };
      if (opts.json === true && process.env.ATLAS_OUTPUT === undefined) {
        process.env.ATLAS_OUTPUT = 'json';
      }
      // --describe short-circuits the action: emit a JSON description of the
      // resolved subcommand and exit successfully. Runs after global hooks
      // but before the action callback.
      if (opts.describe === true) {
        emitDescribe(actionCommand);
        process.exit(0);
      }
    });

  const auth = program.command('auth').description('SSO 会话管理');
  auth
    .command('login')
    .description('打开浏览器完成 SSO 登录并持久化会话')
    .action(async () => {
      try {
        await authLoginCmd();
      } catch (e) {
        handleError(e);
      }
    });
  auth
    .command('status')
    .option('--json', '输出 JSON')
    .description('显示当前会话信息')
    .action(async (opts: { json?: boolean }) => {
      try {
        await authStatusCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('list')
      .description('列出项目中的条目'),
  )
    .option('--json', '输出 JSON')
    .option('--page <n>', '页码（向前兼容）')
    .option('--page-size <n>', '每页数量（向前兼容）')
    .action(async (opts) => {
      try {
        await listCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('show <itemId>')
      .description('显示单个条目（目前为客户端过滤）'),
  )
    .option('--json', '输出 JSON')
    .action(async (itemId: string, opts) => {
      try {
        await showCmd(itemId, opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('month')
      .description('人力基线汇总（按月显示人力投入）'),
  )
    .option('--json', '输出 JSON')
    .option('--department <name>', '按部门名称/ID 筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--area-code <code>', '按地域筛选（子串，不区分大小写）')
    .option('--mp-type <type>', '按人力类型筛选（子串，不区分大小写）')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--all-months', '显示所有月份（默认：只显示有人力的月份）')
    .action(async (opts) => {
      try {
        await monthCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('summary')
      .description('按月/部门/角色汇总人力投入'),
  )
    .option('--by <axis>', 'month | department | role', 'month')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--json', '输出 JSON')
    .action(async (opts) => {
      try {
        await summaryCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('export')
      .description('导出条目到 CSV/JSON（parquet 暂未实现）'),
  )
    .requiredOption('--format <fmt>', 'csv | json | parquet')
    .requiredOption('--out <path>', '输出文件路径')
    .option('--since <iso>', '仅导出指定时间后修改的条目（ISO 时间戳）')
    .option('--json', '输出 JSON 信封（结果摘要）')
    .action(async (opts) => {
      try {
        if (!['csv', 'json', 'parquet'].includes(opts.format)) {
          throw new ConfigError(`--format must be csv|json|parquet, got "${opts.format}"`);
        }
        await exportCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('fill')
      .description('使用模板批量更新条目（默认仅预览，不实际修改）'),
  )
    .requiredOption('--template <path>', 'Nunjucks/Jinja 模板文件路径')
    .option('--out <path>', '暂存文件路径（默认 ./fill-stage-<projectId>-<ts>.json）')
    .option('--target <target>', 'lineplan（默认）| month — 目标端点', 'lineplan')
    .option('--llm <model>', '可选 LLM 模型 ID（Claude）。需要设置 ANTHROPIC_API_KEY 环境变量')
    .option('--apply', '读取暂存文件并提交更新到服务器')
    .option('--json', '输出 JSON 结果')
    .action(async (opts) => {
      try {
        await fillCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('import')
      .description('从 .xlsx/.csv 批量导入人力数据（默认仅预览）'),
  )
    .requiredOption('--file <path>', '.xlsx（推荐）或 .csv 文件路径')
    .option('--target <target>', 'lineplan | month（默认）— 目标端点', 'month')
    .option('--apply', '实际上传文件到服务器')
    .option('--json', '输出 JSON 结果')
    .action(async (opts) => {
      try {
        await importCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('daemon')
    .description('启动本地守护进程（沙盒环境使用，保持浏览器会话）')
    .option('--port <n>', '监听端口', '8765')
    .action(async (opts) => {
      try {
        await daemonCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('resolve <kind> <query>')
    .description(
      '将名称/子串解析为候选 ID（kind: project|department|mp-type|line-plan-type|src-type|area-code）',
    )
    .option('--json', '输出 JSON 信封')
    .option('--refresh', '刷新字典/部门/项目缓存')
    .option('--limit <n>', '最多返回 N 个候选（默认 20）')
    .action(async (kind: string, query: string, opts) => {
      try {
        await resolveCmd(kind, query, opts);
      } catch (e) {
        handleError(e);
      }
    });

  const schema = program.command('schema').description('CLI 自省 / 字段字典导出');
  schema
    .command('export')
    .description('导出字典 + 部门树，供 skill 缓存对照')
    .option('--out <path>', '同时写入文件路径')
    .option('--refresh', '刷新缓存')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await schemaExportCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });
  schema
    .command('commands')
    .description('列出所有命令的参数 schema')
    .option('--json', '输出 JSON 信封')
    .action((opts) => {
      try {
        schemaCommandsCmd(program, opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('undo [token]')
    .description('回滚先前的 fill --apply 操作（基于 ~/.cache/atlas/undo 下的 manifest）')
    .option('--list', '列出最近的 undo manifest')
    .option('--limit <n>', '配合 --list 使用，最多返回 N 条（默认 30）')
    .option('--json', '输出 JSON 信封')
    .action(async (token: string | undefined, opts) => {
      try {
        await undoCmd(token, opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('exec')
    .description('按 plan-file 顺序执行多条命令（agent 批处理用）')
    .requiredOption('--plan-file <path>', 'JSON 计划文件路径，schema: {steps: [{name?, cmd, args?}], stopOnError?}')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await execCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('suggest <query...>')
    .description('将自然语言查询翻译为候选 atlas 命令（纯规则，不调 LLM）')
    .option('--json', '输出 JSON 信封')
    .action((tokens: string[], opts) => {
      try {
        suggestCmd(tokens.join(' '), opts);
      } catch (e) {
        handleError(e);
      }
    });

  addProjectOptions(
    program
      .command('actual')
      .description('实际投入工时（按周显示，区别于 month 基线数据）'),
  )
    .option('--month <yyyymm>', '查询月份（YYYY-MM，默认当月）')
    .option('--status <status>', '筛选审批状态: pending | approved | all', 'all')
    .option('--department <name>', '按团队负责人/部门筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--staff-name <name>', '按姓名/工号筛选（子串，不区分大小写）')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await actualCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('link [project]')
    .description('绑定当前项目（精确名称/子串/数字ID）。不带参数时显示当前绑定状态')
    .option('--json', '输出 JSON 信封')
    .option('--refresh-projects', '解析 project 前重新获取项目目录缓存')
    .action(async (project: string | undefined, opts) => {
      try {
        if (project === undefined) {
          await linkStatusCmd(opts);
        } else {
          await linkCmd(project, opts);
        }
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command('unlink')
    .description('清除当前项目绑定')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await unlinkCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  return program;
}

// Run whenever this module is the entry point — including via bin symlink.
// (argv[1] may be a symlink target like /opt/homebrew/bin/atlas that
// neither ends in .js nor matches import.meta.url.)
//
// `atlas exec` re-imports this module to dispatch sub-steps in-process; in
// that path it sets ATLAS_SKIP_AUTORUN=1 to prevent the second auto-run.
if (process.env.ATLAS_SKIP_AUTORUN !== '1') {
  const program = buildProgram();
  program.parseAsync(process.argv).catch(handleError);
}
