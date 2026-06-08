# Atlas CLI 使用文档

> Atlas CLI - 斑马云图人力基线管理工具

## 快速开始

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行 CLI
npx tsx adapters/atlas/cli.ts --help
```

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 以 JSON 信封格式输出（也可设置环境变量 `ATLAS_OUTPUT=json`） |
| `--describe` | 不执行命令，仅输出该命令的参数 schema（agent 自省用） |

## 公共选项（带项目上下文的命令）

以下命令共享 `--project-id` 和 `--refresh-projects` 选项：
`list`, `show`, `month`, `summary`, `export`, `fill`, `import`, `compare`, `actual`, `resolve`

| 选项 | 说明 |
|------|------|
| `--project-id <id>` | 项目 ID，精确名称或唯一子串（或使用 `BANMA_PROJECT_ID` 环境变量） |
| `--refresh-projects` | 解析 `--project-id` 前重新获取项目目录缓存 |

---

## 命令参考

### 认证

#### `atlas auth login`

打开浏览器完成 SSO 登录并持久化会话。

```bash
atlas auth login
```

#### `atlas auth status`

显示当前会话信息。

```bash
atlas auth status [--json]
```

---

### 项目绑定

#### `atlas link [project]`

绑定当前项目（精确名称/子串/数字 ID）。不带参数时显示当前绑定状态。

```bash
atlas link                  # 显示当前绑定状态
atlas link "项目名称"        # 绑定指定项目
atlas link --refresh-projects "项目名称"  # 刷新缓存后绑定
```

#### `atlas unlink`

清除当前项目绑定。

```bash
atlas unlink [--json]
```

---

### 数据查询

#### `atlas list`

列出项目中的条目。

```bash
atlas list [--json] [--page <n>] [--page-size <n>]
```

| 选项 | 说明 |
|------|------|
| `--page <n>` | 页码（向前兼容） |
| `--page-size <n>` | 每页数量（向前兼容） |

#### `atlas show <itemId>`

显示单个条目（目前为客户端过滤）。

```bash
atlas show <itemId> [--json]
```

#### `atlas month`

人力基线汇总（按月显示人力投入）。

```bash
atlas month [--json] [--department <name>] [--role <name>] [--area-code <code>] [--mp-type <type>] [--from <yyyymm>] [--to <yyyymm>] [--all-months]
```

| 选项 | 说明 |
|------|------|
| `--department <name>` | 按部门名称/ID 筛选（子串，不区分大小写） |
| `--role <name>` | 按角色/备注筛选（子串，不区分大小写） |
| `--area-code <code>` | 按地域筛选（子串，不区分大小写） |
| `--mp-type <type>` | 按人力类型筛选（子串，不区分大小写） |
| `--from <yyyymm>` | 起始月份（YYYY-MM，包含） |
| `--to <yyyymm>` | 结束月份（YYYY-MM，包含） |
| `--all-months` | 显示所有月份（默认：只显示有人力的月份） |

#### `atlas summary`

按月/部门/角色汇总人力投入。

```bash
atlas summary [--by <axis>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--by <axis>` | `month` / `department` / `role` | `month` |
| `--from <yyyymm>` | 起始月份（YYYY-MM，包含） | — |
| `--to <yyyymm>` | 结束月份（YYYY-MM，包含） | — |

#### `atlas actual`

实际投入工时（按周显示，区别于 month 基线数据）。

```bash
atlas actual [--month <yyyymm>] [--status <status>] [--department <name>] [--role <name>] [--staff-name <name>] [--from <yyyymm>] [--to <yyyymm>] [--by <axis>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--month <yyyymm>` | 查询月份（YYYY-MM） | 当月 |
| `--status <status>` | `pending` / `approved` / `all` | `all` |
| `--department <name>` | 按部门筛选（子串，不区分大小写） | — |
| `--role <name>` | 按角色/备注筛选（子串，不区分大小写） | — |
| `--staff-name <name>` | 按姓名/工号筛选（子串，不区分大小写） | — |
| `--from <yyyymm>` | 起始月份（YYYY-MM，包含） | — |
| `--to <yyyymm>` | 结束月份（YYYY-MM，包含） | — |
| `--by <axis>` | `month` / `department` / `role` — 汇总维度（设置后输出汇总表而非明细表） | — |

#### `atlas resolve <kind> <query>`

将名称/子串解析为候选 ID。

```bash
atlas resolve <kind> <query> [--json] [--refresh] [--limit <n>]
```

支持的 kind：`project` / `department` / `mp-type` / `line-plan-type` / `src-type` / `area-code`

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--refresh` | 刷新字典/部门/项目缓存 | — |
| `--limit <n>` | 最多返回 N 个候选 | 20 |

---

### 数据对比

#### `atlas compare` ⭐

对比基线（计划）与实际人力投入。

```bash
atlas compare [--by <axis>] [--from <yyyymm>] [--to <yyyymm>] [--month <yyyymm>] [--department <name>] [--role <name>] [--status <status>] [--threshold <n>] [--flag-overrun] [--page <n>] [--page-size <n>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--by <axis>` | `month` / `department` / `role` | `month` |
| `--from <yyyymm>` | 起始月份（YYYY-MM，包含） | — |
| `--to <yyyymm>` | 结束月份（YYYY-MM，包含） | — |
| `--month <yyyymm>` | 查询月份（优先级高于 from/to，用于实际数据 API） | 当前月 |
| `--department <name>` | 按部门筛选 | — |
| `--role <name>` | 按角色筛选 | — |
| `--status <status>` | `pending` / `approved` / `all` | `all` |
| `--threshold <n>` | 差异绝对值阈值（小时），低于此值不标记 | 0 |
| `--flag-overrun` | 用 ⚠️ 标记实际 > 基线的情况 | — |
| `--page <n>` | 页码（从 1 开始，超出范围自动钳制） | 1 |
| `--page-size <n>` | 每页条目数（>0 时启用分页；=0 或省略时返回全部） | 0（不分页） |

**输出列：**

| 列名 | 说明 |
|------|------|
| month/department/role | 维度标签 |
| baseline(h) | 基线工时（小时） |
| actual(h) | 实际工时（小时） |
| diff(h) | 差异值，正数带 `+` 前缀 |
| diff% | 差异百分比（基线为 0 时显示 0%） |
| flag | `⚠️` overrun / `↓` under_threshold / 空（within_threshold） |

**输出示例（分页）：**

```
month    │ baseline(h) │ actual(h) │ diff(h) │ diff%    │ flag
─────────┼─────────────┼───────────┼─────────┼──────────┼──────
2025-04  │ 25          │ 22        │ -3      │ -12.0%   │
2025-05  │ 30          │ 35        │ +5      │ +16.7%   │ ⚠️

2 bucket(s) by month in project "Demo" (PRJ001)
Baseline total: 55h | Actual total: 57h | Diff: +2h (+3.6%)
Page 1/3 (2 items per page, 5 total)
```

**JSON 输出格式：**

```json
{
  "ok": true,
  "data": {
    "projectId": "PRJ001",
    "projectName": "Demo",
    "by": "month",
    "entries": [...],
    "baselineTotal": 55,
    "actualTotal": 57,
    "grandDiff": 2,
    "grandDiffPercent": 3.6,
    "month": "2025-06",
    "filter": { ... },
    "page": { "page": 1, "pageSize": 2, "totalPages": 3, "totalEntries": 5 }
  },
  "meta": {
    "rows": 2,
    "baselineTotal": 55,
    "actualTotal": 57,
    "grandDiff": 2,
    "grandDiffPercent": 3.6,
    "pagination": { "page": 1, "pageSize": 2, "totalPages": 3, "totalEntries": 5 }
  }
}
```

---

### 数据导出

#### `atlas export`

导出条目到 CSV/JSON 文件。

```bash
atlas export --format <fmt> --out <path> [--target <target>] [--by <axis>] [--status <status>] [--department <name>] [--role <name>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--format <fmt>` | `csv` / `json` / `parquet`（暂未实现） | **必填** |
| `--out <path>` | 输出文件路径 | **必填** |
| `--target <target>` | `baseline` / `actual` | `baseline` |
| `--by <axis>` | `month` / `department` / `role`（仅 `--target actual` 时有效） | `month` |
| `--status <status>` | `pending` / `approved` / `all`（仅 `--target actual` 时有效） | `all` |
| `--department <name>` | 按部门筛选（仅 `--target actual` 时有效） | — |
| `--role <name>` | 按角色筛选（仅 `--target actual` 时有效） | — |
| `--from <yyyymm>` | 起始月份 | — |
| `--to <yyyymm>` | 结束月份 | — |

**导出 baseline 示例：**

```bash
atlas export --format csv --out ./baseline.csv --since 2025-01-01T00:00:00Z
```

**导出 actual 示例：**

```bash
atlas export --format json --out ./actual.json --target actual --by department --status approved
```

---

### 数据导入

#### `atlas import`

从 .xlsx/.csv 批量导入人力数据（默认仅预览）。

```bash
atlas import --file <path> [--target <target>] [--apply] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--file <path>` | .xlsx（推荐）或 .csv 文件路径 | **必填** |
| `--target <target>` | `lineplan` / `month` | `month` |
| `--apply` | 实际上传文件到服务器 | 预览模式 |

#### `atlas fill`

使用模板批量更新条目（默认仅预览，不实际修改）。

```bash
atlas fill --template <path> [--out <path>] [--target <target>] [--llm <model>] [--apply] [--json]
```

| 选项 | 说明 |
|------|------|
| `--template <path>` | Nunjucks/Jinja 模板文件路径（必填） |
| `--out <path>` | 暂存文件路径（默认 `./fill-stage-<projectId>-<ts>.json`） |
| `--target <target>` | `lineplan` / `month` |
| `--llm <model>` | 可选 LLM 模型 ID（需设置 `ANTHROPIC_API_KEY`） |
| `--apply` | 读取暂存文件并提交更新到服务器 |

---

### 批量执行

#### `atlas exec`

按 plan-file 顺序执行多条命令（agent 批处理用）。

```bash
atlas exec --plan-file <path> [--json]
```

plan-file JSON 格式：

```json
{
  "steps": [
    { "name": "step1", "cmd": "list", "args": { "--json": true } },
    { "name": "step2", "cmd": "summary", "args": { "--by": "department" } }
  ],
  "stopOnError": true
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` (可选) | 步骤显示名称，默认取 `cmd` 值 |
| `cmd` | `string` | 子命令名（如 `list`、`summary`、`month`、`export` 等），不带 `atlas` 前缀 |
| `args` | `object` (可选) | 键值对参数，key 需带 `--` 前缀（如 `"--json"`），boolean `true` 表示仅加 flag，`false` 跳过，string/number 值会作为参数跟在 flag 后 |
| `stopOnError` | `boolean` (可选) | 某步失败时是否停止，默认 `true` |

---

### 撤销

#### `atlas undo [token]`

回滚先前的 `fill --apply` 操作（基于 `~/.cache/atlas/undo` 下的 manifest）。

```bash
atlas undo --list [--limit <n>]   # 列出最近的 undo manifest
atlas undo <token>                 # 执行回滚
```

---

### Schema 自省

#### `atlas schema export`

导出字典 + 部门树，供 skill 缓存对照。

```bash
atlas schema export [--out <path>] [--refresh] [--json]
```

#### `atlas schema commands`

列出所有命令的参数 schema。

```bash
atlas schema commands [--json]
```

---

### 守护进程

#### `atlas daemon`

启动本地守护进程（沙盒环境使用，保持浏览器会话）。

```bash
atlas daemon [--port <n>]
```

默认端口：`8765`

---

### 建议

#### `atlas suggest <query...>`

将自然语言查询翻译为候选 atlas 命令（纯规则，不调 LLM）。

```bash
atlas suggest "查看研发部五月份人力"
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `BANMA_PROJECT_ID` | 默认项目 ID |
| `ATLAS_DAEMON_PORT` | 守护进程端口（默认 8765） |
| `ATLAS_DAEMON=true` | 强制使用 daemon 模式 |
| `ATLAS_OUTPUT=json` | 全局 JSON 输出模式 |
| `ATLAS_JSON=1` | JSON 输出模式（兼容） |
| `ANTHROPIC_API_KEY` | LLM API 密钥（用于 `fill --llm`） |

## 构建与验证

```bash
# TypeScript 编译
npm run build

# 运行验证
npm run verify

# Bun 编译为单文件二进制（实验性）
npm run build:bun
```

## 测试

```bash
# 运行所有测试
npm run test

# 监听模式
npm run test:watch
```