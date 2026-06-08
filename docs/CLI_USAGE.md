# Atlas CLI 使用文档

> Atlas CLI - 斑马云图人力基线管理工具

## 安装

```bash
# 通过 npm 安装（推荐）
npm install -g atlas-cli

# 或从源码编译
npm install
npm run build
npm link
```

## 快速开始

```bash
# 认证（首次使用）
atlas auth login

# 查看会话状态
atlas auth status

# 搜索项目
atlas find project BMW

# 绑定项目（后续命令可省略 --project-id）
atlas link "BMW IPA LLM 0726 项目"

# 查看基线
atlas baseline month

# 查看实际工时
atlas actual list

# 对比基线 vs 实际
atlas compare --from 2026-01 --to 2026-06
```

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 以 JSON 信封格式输出（也可设置环境变量 `ATLAS_OUTPUT=json`） |
| `--describe` | 不执行命令，仅输出该命令的参数 schema（agent 自省用） |

## 公共选项（带项目上下文的命令）

以下命令共享 `--project-id` 和 `--refresh-projects` 选项：
`baseline *`、`actual *`、`compare`

| 选项 | 说明 |
|------|------|
| `--project-id <id>` | 项目 ID、精确名称或唯一子串（或使用 `BANMA_PROJECT_ID` 环境变量） |
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

### 项目相关

#### `atlas find <kind> <query>`

搜索项目/部门/字典值。替代旧版 `resolve` 命令。

```bash
atlas find project "BMW"                 # 搜索项目
atlas find department "斑马"              # 搜索部门
atlas find mp-type "研发"                 # 搜索人力类型
```

支持 kind：`project` / `department` / `mp-type` / `line-plan-type` / `src-type` / `area-code`

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--refresh` | 刷新缓存 | — |
| `--limit <n>` | 最多返回 N 个候选 | 20 |

#### `atlas projects`

列出有权限的所有项目。

```bash
atlas projects [--json] [--refresh]
```

#### `atlas link [project]`

绑定当前项目。绑定后可省略 `--project-id`。

```bash
atlas link                  # 显示当前绑定状态
atlas link "项目名称"        # 绑定指定项目
atlas link 2548             # 按 ID 绑定
```

#### `atlas unlink`

清除当前项目绑定。

```bash
atlas unlink [--json]
```

---

### 基线数据（Baseline）— 单位：人月

#### `atlas baseline list`

列出基线条目。

```bash
atlas baseline list [--json] [--page <n>] [--page-size <n>]
```

#### `atlas baseline show <itemId>`

显示单个条目详情。

```bash
atlas baseline show <itemId> [--json]
```

#### `atlas baseline month`

按月汇总人力投入。

```bash
atlas baseline month [--json] [--department <name>] [--role <name>] [--area-code <code>] [--mp-type <type>] [--from <yyyymm>] [--to <yyyymm>] [--all-months]
```

#### `atlas baseline summary`

按维度汇总。

```bash
atlas baseline summary [--by <axis>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--by <axis>` | `month` / `department` / `role` | `month` |

#### `atlas baseline export`

导出 CSV/JSON。

```bash
atlas baseline export --format <fmt> --out <path> [--since <iso>] [--json]
```

#### `atlas baseline fill`

模板批量更新（默认预览）。

```bash
atlas baseline fill --template <path> [--out <path>] [--target <target>] [--llm <model>] [--apply] [--json]
```

#### `atlas baseline import`

文件批量导入（默认预览）。

```bash
atlas baseline import --file <path> [--target <target>] [--apply] [--json]
```

---

### 实际工时数据（Actual）— 单位：人天

#### `atlas actual list`

明细透视表（人员 × 周）。

```bash
atlas actual list [--month <yyyymm>] [--status <status>] [--department <name>] [--role <name>] [--staff-name <name>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

#### `atlas actual show <staffId>`

单个人员工时明细。

```bash
atlas actual show <staffId> [--month <yyyymm>] [--json]
```

#### `atlas actual month`

月度视图。

```bash
atlas actual month [--month <yyyymm>] [--status <status>] [--department <name>] [--role <name>] [--staff-name <name>] [--json]
```

#### `atlas actual summary`

按维度汇总。

```bash
atlas actual summary [--by <axis>] [--month <yyyymm>] [--status <status>] [--department <name>] [--role <name>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

#### `atlas actual export`

导出 CSV/JSON。

```bash
atlas actual export --format <fmt> --out <path> [--by <axis>] [--status <status>] [--department <name>] [--role <name>] [--from <yyyymm>] [--to <yyyymm>] [--json]
```

---

### 数据对比

#### `atlas compare`

对比基线（人月）与实际（自动人天÷22→人月）人力投入。

- `--by month`：使用 API `mp` 精确人月值
- `--by department/role`：从 `weeklyActuals` 分解后 ÷22 转人月

```bash
atlas compare [--by <axis>] [--from <yyyymm>] [--to <yyyymm>] [--month <yyyymm>] [--department <name>] [--role <name>] [--status <status>] [--threshold <n>] [--flag-overrun] [--page <n>] [--page-size <n>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--by <axis>` | `month` / `department` / `role` | `month` |
| `--threshold <n>` | 差异阈值（人月） | 0 |
| `--flag-overrun` | ⚠️标记实际>基线 | — |

**输出示例：**
```
month    │ baseline(h) │ actual(h) │ diff(h)  │ diff%    │ flag
─────────┼─────────────┼───────────┼──────────┼──────────┼──────
2025-09  │ 28.8        │ 26.96     │ -1.84    │ -6.4%    │
2025-10  │ 28.8        │ 30.43     │ +1.63    │ +5.7%    │
2025-11  │ 28.8        │ 33.83     │ +5.03    │ +17.5%   │ ⚠️
```

---

### 其他

#### `atlas schema export` / `atlas schema commands`

```bash
atlas schema export [--out <path>] [--refresh] [--json]
atlas schema commands [--json]
```

#### `atlas daemon`

```bash
atlas daemon [--port <n>]
```

#### `atlas undo [token]`

```bash
atlas undo --list [--limit <n>]
atlas undo <token>
```

#### `atlas exec`

```bash
atlas exec --plan-file <path> [--json]
```

#### `atlas suggest <query...>`

```bash
atlas suggest "查看研发部五月份人力"
```

---

## 命令结构速查

```
atlas
├── auth {login,status}
├── find <kind> <query>         # 搜索
├── projects                    # 列出项目
├── link [project] / unlink     # 绑定/解绑
├── baseline                    # 基线（人月）
│   ├── list/show/month/summary
│   └── export/fill/import
├── actual                      # 实际（人天）
│   ├── list/show/month/summary
│   └── export
├── compare                     # 基线 vs 实际
├── schema {export,commands}
├── daemon / undo / exec / suggest
```

## 数据单位

| 数据 | 单位 | 说明 |
|------|------|------|
| 基线 `month/summary` | 人月 | 规划人力 |
| 实际 `list/month/summary` | 人天 | `weeklyActuals` 原始值 |
| 实际 API `mp` | 人月 | 权威聚合值 |
| `compare --by month` | 人月 | 直接使用 API `mp` |
| `compare --by dept/role` | 人月 | 人天 ÷22 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `BANMA_PROJECT_ID` | 默认项目 ID |
| `ATLAS_DAEMON_PORT` | 守护进程端口（默认 8765） |
| `ATLAS_DAEMON=true` | 强制 daemon 模式 |
| `ATLAS_OUTPUT=json` | 全局 JSON 输出 |
| `ANTHROPIC_API_KEY` | 用于 `fill --llm` |

## 构建与测试

```bash
npm run build       # TypeScript 编译
npm run lint        # 类型检查
npm run verify      # 验证 CLI 可运行
npm run test        # 测试（285 个）
npm run test:watch  # 监听模式

# Bun 单文件编译
npm run build:bun:mac-arm64
```