# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Atlas CLI - 斑马云图人力基线管理工具，用于管理斑马系统中的项目人力投入数据。

## Commands

```bash
npm run build        # TypeScript 编译
npm run lint         # 类型检查（tsc --noEmit）
npm run test         # 运行所有测试 (vitest，共 285 个)
npm run test:watch   # 监听模式运行测试
npm run verify       # 验证编译后的 CLI
npm run auth:login   # 启动登录流程
npm run build:bun    # 用 Bun 编译为单文件二进制（实验性，详见 docs/BUN_BUILD.md）
```

## Architecture

```
adapters/atlas/
├── cli.ts                  # Commander 入口，6 个 register* 子函数
├── commands/
│   ├── project/            # find, projects, link, unlink
│   ├── baseline/           # list, show, month, summary, export, fill, import
│   ├── actual/             # list, show, month, summary, export
│   ├── compare/            # compare
│   ├── auth.ts             # auth login/status
│   ├── schema.ts           # schema export/commands
│   ├── exec.ts             # exec --plan-file
│   ├── suggest.ts          # suggest NL→CLI
│   ├── undo.ts             # undo manifest
│   └── _*.ts               # 内部逻辑（_actual_logic, _month_logic, _compare_logic 等）
├── auth/                   # 认证模块 (session 存储：keytar 或文件)
├── daemon/                 # 沙盒环境守护进程 (server + client)
├── http/                   # HTTP 客户端 (undici)
├── schema/                 # Zod 数据模型
├── dict/                   # 缓存 (项目目录、部门)
└── util/                   # 工具函数 (errors, paths, sandbox)
```

## Command Reference

```
atlas
├── auth {login,status}              # 认证
├── find <kind> <query>              # 搜索项目/部门/字典
├── projects                         # 列出所有项目
├── link [project] / unlink          # 绑定/解绑项目
├── baseline                         # 基线人力（人月）
│   ├── list/show/month/summary
│   ├── export/fill/import
├── actual                           # 实际工时（人天）
│   ├── list/show/month/summary
│   └── export
├── compare                          # 基线 vs 实际对比
├── schema {export,commands}         # 自省
├── daemon / undo / exec / suggest   # 工具
```

## Key Concepts

- **Session**: 通过 Playwright 浏览器登录后提取的认证信息，存储在 macOS Keychain 或文件
- **Daemon Mode**: 沙盒环境下运行的 HTTP 守护进程，保持浏览器会话活跃
- **Sandbox Detection**: 通过尝试写入 ~/.config 判断是否在受限环境中
- **Commands**: 使用 Zod 进行输入验证，使用 undici 进行 HTTP 请求
- **Data Units**: 基线单位**人月**，实际 unit 人天，compare 人天÷22→人月后对比
- **CST Timezone**: API 时间戳为 UTC+8 午夜，`epochMsToMonthKey` 加 8h 偏移后解析

## Environment Variables

- `BANMA_PROJECT_ID` - 默认项目 ID
- `ATLAS_DAEMON_PORT` - 守护进程端口 (默认 8765)
- `ATLAS_DAEMON=true` - 强制使用 daemon 模式

## Testing

- 285 tests (22 files), all pass
- Unit tests in `tests/` matching `commands/` structure
- E2E test `tests/e2e-web-vs-cli.test.ts` uses Playwright to verify data alignment