#!/usr/bin/env node
import { Command } from 'commander';

// Auth
import { authLoginCmd, authStatusCmd } from './commands/auth.js';

// Project commands (find, projects, link, unlink)
import {
  findCmd,
  linkCmd,
  linkStatusCmd,
  unlinkCmd,
  projectsCmd,
} from './commands/project/index.js';

// Baseline commands (month, summary, export, fill, import)
import {
  monthCmd as baselineMonthCmd,
  summaryCmd as baselineSummaryCmd,
  exportCmd as baselineExportCmd,
  fillCmd as baselineFillCmd,
  importCmd as baselineImportCmd,
} from './commands/baseline/index.js';

// Actual commands (list, show, month, summary, export)
import {
  showCmd as actualShowCmd,
  monthCmd as actualMonthCmd,
  summaryCmd as actualSummaryCmd,
  exportCmd as actualExportCmd,
} from './commands/actual/index.js';

// Compare
import { compareCmd } from './commands/compare/index.js';

// Utility commands
import { daemonCmd } from './daemon/index.js';
import { schemaCommandsCmd, schemaExportCmd } from './commands/schema.js';
import { undoCmd } from './commands/undo.js';
import { execCmd } from './commands/exec.js';
import { suggestCmd } from './commands/suggest.js';

import {
  BanmaApiError,
  ConfigError,
  NotImplementedError,
  SessionExpiredError,
} from './util/errors.js';
import { isJsonMode, printError } from './util/output.js';

function handleError(err: unknown): never {
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
      required: o.mandatory ?? false,
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

// ---------------------------------------------------------------------------
// Registration functions
// ---------------------------------------------------------------------------

function registerAuthCommands(program: Command): void {
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
}

function registerProjectCommands(program: Command): void {
  // atlas find
  program
    .command('find <kind> <query>')
    .description(
      '搜索项目/部门/字典值（kind: project|department|mp-type|line-plan-type|area-code）',
    )
    .option('--json', '输出 JSON 信封')
    .option('--refresh', '刷新字典/部门/项目缓存')
    .option('--limit <n>', '最多返回 N 个候选（默认 20）')
    .action(async (kind: string, query: string, opts) => {
      try {
        await findCmd(kind, query, opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas projects
  program
    .command('projects')
    .description('列出我有权限的所有项目')
    .option('--json', '输出 JSON 信封')
    .option('--refresh', '刷新项目缓存')
    .action(async (opts) => {
      try {
        await projectsCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas link
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

  // atlas unlink
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
}

function registerBaselineCommands(program: Command): void {
  const base = program.command('baseline').description('基线（计划）人力数据');

  // atlas baseline month
  addProjectOptions(
    base
      .command('month')
      .description('人力基线汇总（按月显示人力投入）'),
  )
    .option('--json', '输出 JSON')
    .option('--department <name>', '按部门名称/ID 筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--area-code <code>', '按地域筛选（子串，不区分大小写）')
    .option('--mp-type <type>', '按人力类型筛选（子串，不区分大小写）')
    .option('--month <yyyymm>', '查询月份（YYYY-MM，与 --from/--to 互斥）')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--all-months', '显示所有月份（默认：只显示有人力的月份）')
    .action(async (opts) => {
      try {
        await baselineMonthCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas baseline summary
  addProjectOptions(
    base
      .command('summary')
      .description('按月/部门/角色汇总基线人力投入'),
  )
    .option('--by <axis>', 'month | department | role', 'month')
    .option('--department <name>', '按部门名称/ID 筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--area-code <code>', '按地域筛选（子串，不区分大小写）')
    .option('--mp-type <type>', '按人力类型筛选（子串，不区分大小写）')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--json', '输出 JSON')
    .action(async (opts) => {
      try {
        await baselineSummaryCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas baseline export
  addProjectOptions(
    base
      .command('export')
      .description('导出基线条目到 CSV/JSON'),
  )
    .requiredOption('--format <fmt>', 'csv | json | parquet')
    .requiredOption('--out <path>', '输出文件路径')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--department <name>', '按部门名称/ID 筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--since <iso>', '仅导出指定时间后修改的条目（ISO 时间戳）')
    .option('--json', '输出 JSON 信封（结果摘要）')
    .action(async (opts) => {
      try {
        if (!['csv', 'json', 'parquet'].includes(opts.format)) {
          throw new ConfigError(`--format must be csv|json|parquet, got "${opts.format}"`);
        }
        await baselineExportCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas baseline fill
  addProjectOptions(
    base
      .command('fill')
      .description('使用模板批量更新条目（默认仅预览，不实际修改）'),
  )
    .requiredOption('--template <path>', 'Nunjucks/Jinja 模板文件路径')
    .option('--out <path>', '暂存文件路径')
    .option('--target <target>', 'lineplan（默认）| month — 目标端点', 'lineplan')
    .option('--llm <model>', '可选 LLM 模型 ID（Claude）。需要设置 ANTHROPIC_API_KEY 环境变量')
    .option('--apply', '读取暂存文件并提交更新到服务器')
    .option('--json', '输出 JSON 结果')
    .action(async (opts) => {
      try {
        await baselineFillCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas baseline import
  addProjectOptions(
    base
      .command('import')
      .description('从 .xlsx/.csv 批量导入人力数据（默认仅预览）'),
  )
    .requiredOption('--file <path>', '.xlsx（推荐）或 .csv 文件路径')
    .option('--target <target>', 'lineplan | month（默认）— 目标端点', 'month')
    .option('--apply', '实际上传文件到服务器')
    .option('--json', '输出 JSON 结果')
    .action(async (opts) => {
      try {
        await baselineImportCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });
}

function registerActualCommands(program: Command): void {
  const base = program.command('actual').description('实际人力数据');

  // atlas actual show <staffId>
  addProjectOptions(
    base
      .command('show <staffId>')
      .description('查看单个人员的实际工时明细'),
  )
    .option('--month <yyyymm>', '查询月份（YYYY-MM，默认当前月）')
    .option('--json', '输出 JSON 信封')
    .action(async (staffId: string, opts) => {
      try {
        await actualShowCmd(staffId, opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas actual month
  addProjectOptions(
    base
      .command('month')
      .description('实际工时明细（人员×周透视表）。无参数时默认查当前自然年'),
  )
    .option('--month <yyyymm>', '查询月份（YYYY-MM，与 --from/--to 互斥）')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含，与 --month 互斥）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含，与 --month 互斥）')
    .option('--status <status>', '筛选审批状态: pending | approved | all', 'all')
    .option('--department <name>', '按团队负责人/部门筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--staff-name <name>', '按姓名/工号筛选（子串，不区分大小写）')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await actualMonthCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas actual summary
  addProjectOptions(
    base
      .command('summary')
      .description('按月/部门/角色汇总实际工时'),
  )
    .option('--by <axis>', 'month | department | role', 'month')
    .option('--month <yyyymm>', '查询月份')
    .option('--status <status>', 'pending | approved | all', 'all')
    .option('--department <name>', '按部门筛选')
    .option('--role <name>', '按角色筛选')
    .option('--from <yyyymm>', '起始月份')
    .option('--to <yyyymm>', '结束月份')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await actualSummaryCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // atlas actual export
  addProjectOptions(
    base
      .command('export')
      .description('导出实际工时数据（CSV/JSON）'),
  )
    .requiredOption('--format <fmt>', 'csv | json | parquet')
    .requiredOption('--out <path>', '输出文件路径')
    .option('--by <axis>', 'month | department | role', 'month')
    .option('--status <status>', 'pending | approved | all', 'all')
    .option('--department <name>', '按部门筛选')
    .option('--role <name>', '按角色筛选')
    .option('--from <yyyymm>', '起始月份')
    .option('--to <yyyymm>', '结束月份')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await actualExportCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });
}

function registerCompareCommands(program: Command): void {
  addProjectOptions(
    program
      .command('compare')
      .description('Compare baseline (计划) vs actual (实际) manpower'),
  )
    .option('--by <axis>', 'month | department | role', 'month')
    .option('--from <yyyymm>', '起始月份（YYYY-MM，包含）')
    .option('--to <yyyymm>', '结束月份（YYYY-MM，包含）')
    .option('--month <yyyymm>', '查询月份（YYYY-MM，优先级高于 from/to 用于实际数据 API）')
    .option('--department <name>', '按部门名称/ID 筛选（子串，不区分大小写）')
    .option('--role <name>', '按角色/备注筛选（子串，不区分大小写）')
    .option('--status <status>', '筛选审批状态: pending | approved | all', 'all')
    .option('--threshold <n>', '差异绝对值阈值（小时），低于此值不标记', '0')
    .option('--flag-overrun', '用 ⚠️ 标记实际 > 基线的情况')
    .option('--page <n>', '页码（从 1 开始）')
    .option('--page-size <n>', '每页条目数（大于 0 时启用分页）')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await compareCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });
}

function registerUtilityCommands(program: Command): void {
  // daemon
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

  // schema
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

  // undo
  program
    .command('undo [token]')
    .description('回滚先前的 fill --apply 操作')
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

  // exec
  program
    .command('exec')
    .description('按 plan-file 顺序执行多条命令（agent 批处理用）')
    .requiredOption('--plan-file <path>', 'JSON 计划文件路径')
    .option('--json', '输出 JSON 信封')
    .action(async (opts) => {
      try {
        await execCmd(opts);
      } catch (e) {
        handleError(e);
      }
    });

  // suggest
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
      const opts = thisCommand.opts() as { json?: boolean; describe?: boolean };
      if (opts.json === true && process.env.ATLAS_OUTPUT === undefined) {
        process.env.ATLAS_OUTPUT = 'json';
      }
      if (opts.describe === true) {
        emitDescribe(actionCommand);
        process.exit(0);
      }
    });

  registerAuthCommands(program);
  registerProjectCommands(program);
  registerBaselineCommands(program);
  registerActualCommands(program);
  registerCompareCommands(program);
  registerUtilityCommands(program);

  return program;
}

// Run whenever this module is the entry point — including via bin symlink.
//
// `atlas exec` re-imports this module to dispatch sub-steps in-process; in
// that path it sets ATLAS_SKIP_AUTORUN=1 to prevent the second auto-run.
if (process.env.ATLAS_SKIP_AUTORUN !== '1') {
  const program = buildProgram();

  // Intercept --describe before parseAsync to bypass Commander's
  // requiredOption validation (Commander fires that before preAction).
  if (process.argv.includes('--describe')) {
    const rest = process.argv.slice(2).filter(
      (a) => a !== '--describe' && !a.startsWith('--json'),
    );
    let cmd: Command = program;
    for (const word of rest) {
      if (word.startsWith('-')) break;
      const child = cmd.commands.find((c) => c.name() === word);
      if (!child) break;
      cmd = child;
    }
    emitDescribe(cmd);
    process.exit(0);
  }

  program.parseAsync(process.argv).catch(handleError);
}