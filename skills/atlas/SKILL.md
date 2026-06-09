---
name: atlas
description: 通过 Atlas CLI 读写斑马云图人力基线项目数据（baseline/actual/compare）。当用户想要列出/导出/编辑条目、查看人力基线汇总、查看实际工时、做基线 vs 实际对比分析、按月/部门/角色汇总人力、从 Excel 批量导入人力或生成模板化更新时使用此技能。
---

# Atlas CLI — 斑马云图人力基线管理工具

薄 TypeScript CLI 层，封装斑马云图 `yuntu-service` API 用于 mpLine 场景。通过有头 Playwright 浏览器完成一次 BUC SSO 认证，然后为每次后续 HTTP 调用重放 cookie + `x-banma-*` 请求头。

**禁止**将此用于 RFT 任务、PMP 工单、Aone 代码或任何非 mpLine 场景 — 适配器按设计仅限于 mpLine 表面。

---

## 快速开始

执行任何 atlas 命令前，按顺序完成以下步骤。

### 1. 安装 CLI（如未安装）

```bash
# 检查是否已安装
atlas --help >/dev/null 2>&1 && echo "atlas OK" || echo "need install"
```

如果未安装，通过 install 脚本下载并安装（**自动处理所有依赖**：CLI 二进制 + Node.js ≥ 20 + npm/npx + Playwright + Chromium）：

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.sh)
```

```cmd
REM Windows (自动检测：有 PowerShell 用 .ps1，否则纯 .bat)
curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.bat | cmd
```

安装后确认 `atlas` 可用，如果提示 `command not found`，让用户新开终端窗口或执行 `source ~/.zshrc`。

> **只读操作可跳过 Playwright**：如果只需 `baseline month` / `baseline summary` / `compare` 等只读命令，无需 Playwright。写入操作（`fill` / `import`）也不需要。仅 `auth login` 和 `daemon` 需要。跳过方式：`ATLAS_SKIP_PLAYWRIGHT=1 bash <(curl -fsSL ...)`

### 2. 登录认证（SSO）

```bash
# 检查会话状况
atlas auth status
```

如果未登录或会话过期：

- 执行 `atlas auth login`
- 这会打开 Chromium 浏览器窗口，跳转到斑马云图 SSO 登录页
- **Agent 无法自动完成**：SSO + OTP 双因子认证需要用户手动在浏览器中完成
- 登录成功后终端会提示并自动关闭浏览器窗口
- 会话信息存储在 `~/.config/atlas/session.json`（仅 600 权限）；macOS 还会额外存入 Keychain（keytar）

查看认证状态验证：

```bash
atlas auth status --json
# → { "ok": true, "data": { "authenticated": true, "account": "...", "empId": "..." } }
```

### 3. 确定项目上下文

```bash
# 列出你有权限的所有项目（从中找到目标项目 ID）
atlas projects

# 绑定项目，后续命令无需再传 --project-id
atlas link <项目名称或ID>

# 或通过参数 / 环境变量指定
atlas baseline month --project-id 2548
export BANMA_PROJECT_ID=2548
```

项目 ID 优先级：`--project-id` 参数 > `BANMA_PROJECT_ID` 环境变量 > `atlas link` 绑定。

项目 ID 有三种指定方式（优先级从高到低）：
1. `--project-id <id>` 参数
2. `BANMA_PROJECT_ID` 环境变量
3. `atlas link` 绑定的项目

---

## 数据模型

| 概念 | 英文 | 单位 | 说明 |
|------|------|------|------|
| **基线** | Baseline | 人月 | 计划/预测的人力投入 |
| **实际** | Actual | 人天 | 实际录入的工作工时 |
| **对比** | Compare | 人月 | 实际人天 ÷ 22 → 人月后对比基线 |

所有 API 时间戳均为 CST（UTC+8）时区。日期参数统一格式：`YYYY-MM`（如 `2024-01`）。

---

## Agent 友好特性

### `--json` 全局参数

**所有命令**都支持 `--json` 参数，输出统一信封格式：

```json
// 成功
{ "ok": true, "data": { ... }, "meta": { ... }, "hint": "..." }

// 错误
{ "ok": false, "code": "API_ERROR", "message": "...", "hint": "...", "details": { ... } }
```

也可通过环境变量启用：`ATLAS_OUTPUT=json` 或 `ATLAS_JSON=1`。

### `--describe` 全局参数

**所有命令**都支持 `--describe`，不执行命令，仅输出该命令的完整参数定义（含所有 option、arg、subcommand 元数据）。Agent 可用此动态发现命令结构：

```bash
atlas baseline month --describe
atlas actual month --describe
atlas compare --describe
```

输出示例：
```json
{
  "ok": true,
  "data": {
    "command": "baseline month",
    "description": "月度汇总",
    "options": [
      { "flags": "--project-id <id>", "description": "项目 ID", "required": true },
      { "flags": "--from <YYYY-MM>", "description": "起始月份" },
      { "flags": "--to <YYYY-MM>", "description": "截止月份" }
    ]
  }
}
```

### `atlas schema commands` — 自省命令树

输出**完整命令树**（含每个命令的 path、description、options、args、subcommands），是 `--describe` 的批量版本。Agent 可据此了解 CLI 的完整能力边界：

```bash
atlas schema commands --json
```

输出片段：
```json
{
  "ok": true,
  "data": {
    "commands": [
      { "path": "atlas baseline month", "description": "月度汇总", "options": [...], "args": [] },
      { "path": "atlas actual month", "description": "实际工时明细", "options": [...], "args": [] },
    ]
  }
}
```

### `atlas exec` — 批量执行计划文件

Agent 可构造 JSON 计划文件，一次调用自动执行多个步骤。适合需要在一次推理中完成多步操作的场景：

```bash
atlas exec --plan-file ./plan.json
```

计划文件格式（Zod 校验）：

```json
{
  "steps": [
    {
      "name": "查看基线",
      "cmd": "baseline month",
      "args": { "--project-id": "2548", "--from": "2024-01", "--to": "2024-03" }
    },
    {
      "name": "查看实际",
      "cmd": "actual month",
      "args": { "--project-id": "2548", "--month": "2024-01" }
    }
  ],
  "stopOnError": true
}
```

每个 step 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | string | 是 | 子命令路径，如 `"baseline month"` |
| `args` | object | 否 | 参数键值对。key 自动补 `--` 前缀；`true` 表示布尔 flag |
| `name` | string | 否 | 步骤名称（默认同 `cmd`） |
| `stopOnError` | boolean | 否 | 出错是否停止（默认 `true`） |

输出结果为统一信封装有 `{ steps: [{ name, cmd, exitCode, result?, error? }], stoppedAt?: idx }`。每个 step 的 `result` 就是该子命令的 JSON 信封。

### `atlas suggest` — 自然语言转命令

纯规则引擎（无 LLM 调用），将中文/英文自然语言翻译为候选 CLI 命令。Agent 可用此辅助解析用户意图：

```bash
atlas suggest 查看今年第一季度的基线数据
atlas suggest 对比研发部1月和2月的实际工时
```

返回建议列表，含 `cmd`、`args`、`confidence`、`reasoning`、`missing` 字段。

### `atlas schema export` — 导出字典数据

导出项目字典值和部门树，结果缓存 24 小时：

```bash
atlas schema export --out ./schema.json
atlas schema export --refresh  # 强制刷新缓存
```

返回 `enums`（mpType/linePlanType/srcType/areaCode）和 `departments`（树形层级）。

---

## 全局选项

| 选项 | 作用 |
|------|------|
| `--help` | 查看命令帮助 |
| `--json` | JSON 信封格式输出（也可通过 `ATLAS_OUTPUT=json` 或 `ATLAS_JSON=1` 环境变量启用） |
| `--describe` | 查看命令的参数定义，不执行命令 |

通用参数（大部分数据命令支持）：

| 参数 | 说明 |
|------|------|
| `--project-id <id>` | 项目 ID（数字或名称） |
| `--refresh-projects` | 刷新项目缓存 |
| `--from YYYY-MM` | 起始月份 |
| `--to YYYY-MM` | 截止月份 |
| `--department <s>` | 部门名称子串过滤 |
| `--role <s>` | 角色名称子串过滤 |
| `--area-code <s>` | 地域代码过滤 |
| `--mp-type <s>` | 人力类型过滤 |
| `--json` | JSON 输出 |

---

## 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 通用错误 / `exec` 中某 step 失败 |
| 2 | 会话过期（`SessionExpiredError`） |
| 3 | API 返回错误（`BanmaApiError`，含 `errCode` / `errorMsg`） |
| 64 | 配置错误 / 未实现（`ConfigError`、`NotImplementedError`） |

---

## 命令参考

### `atlas auth` — 认证

```bash
atlas auth login     # 打开浏览器完成 SSO + 2FA
atlas auth status    # 查看认证状态
```

会话存储：`~/.config/atlas/session.json`（仅 600 权限）；macOS 还额外存入 Keychain（keytar）。

### `atlas projects` — 项目管理

```bash
atlas projects
atlas projects --json
atlas projects --refresh   # 刷新项目缓存
```

### `atlas find` — 搜索

```bash
atlas find project <名称关键词>
atlas find department <部门关键词>
atlas find mp-type <关键词>           # 人力类型：斑马、智软等
atlas find line-plan-type <关键词>    # 线计划类型/业务线：座舱、AI、语音等
atlas find area-code <关键词>         # 地域：北上杭、合肥、武汉等
```

> **注意**：`find` 的 JSON 输出结构与其他命令不同，结果在 `.data.candidates` 数组中：
> ```json
> { "ok": true, "data": { "kind": "project", "query": "斑马", "count": 6, "candidates": [...] } }
> ```

### `atlas link / unlink` — 项目绑定

```bash
atlas link <项目名称或ID>    # 绑定项目
atlas link                   # 查看当前绑定
atlas unlink                 # 解绑
```

### `atlas baseline` — 基线人力（人月）

```bash
# 月度汇总（最常用，行=部门+角色+备注，列=月份）
atlas baseline month --project-id <id>                                   # 无参数=全部月份
atlas baseline month --project-id <id> --month 2024-01                   # 单月
atlas baseline month --project-id <id> --from 2024-01 --to 2024-06       # 范围
atlas baseline month --project-id <id> --department 研发部 --role 前端    # 带过滤

# 多维汇总（支持 --department/--role/--area-code/--mp-type 过滤器）
atlas baseline summary --project-id <id> --by month
atlas baseline summary --project-id <id> --by department --from 2024-01 --to 2024-06
atlas baseline summary --project-id <id> --by department --department 研发

# 导出
atlas baseline export --project-id <id> --format csv --out ./baseline.csv
atlas baseline export --project-id <id> --format json --out ./baseline.json

# 模板批量填充（写入，默认仅预览）
atlas baseline fill --project-id <id> --template ./template.njk --out ./preview.json
atlas baseline fill --project-id <id> --template ./template.njk --apply

# 导入 xlsx/csv（写入，默认仅预览）
atlas baseline import --project-id <id> --file ./data.xlsx
atlas baseline import --project-id <id> --file ./data.xlsx --apply
```

### `atlas actual` — 实际工时（人天）

```bash
# 实际工时明细（人员×周期透视表，无参数默认查当前自然年）
atlas actual month --project-id <id> --month 2024-05
atlas actual month --project-id <id> --from 2024-01 --to 2024-06
atlas actual month --project-id <id> --from 2024-01 --to 2024-06 --department 研发部

# 单人明细
atlas actual show <staffId> --project-id <id> --month 2024-05

# 多维汇总
atlas actual summary --project-id <id> --by month
atlas actual summary --project-id <id> --by department --from 2024-01 --to 2024-06

# 导出
atlas actual export --project-id <id> --format csv --out ./actuals.csv
```

`actual` 特有的过滤参数：

| 参数 | 说明 |
|------|------|
| `--status pending\|approved\|all` | 审批状态过滤（默认 `all`） |
| `--staff-name <s>` | 员工姓名过滤 |
| `--month YYYY-MM` | 指定月份（部分命令必需） |

### `atlas compare` — 对比分析

实际工时（人天）÷ 22 转换为**人月**后与基线进行对比：

```bash
# 按月对比
atlas compare --project-id <id>

# 按部门/角色汇总
atlas compare --project-id <id> --by department
atlas compare --project-id <id> --by role

# 限定月份范围
atlas compare --project-id <id> --from 2024-01 --to 2024-06

# 标记超支（实际 > 基线）
atlas compare --project-id <id> --flag-overrun

# 设置差异阈值（小时）
atlas compare --project-id <id> --threshold 40

# 筛选
atlas compare --project-id <id> --department 研发部 --role 前端
```

对比特有的参数：

| 参数 | 说明 |
|------|------|
| `--flag-overrun` | 标记超支行（实际 > 基线） |
| `--threshold <n>` | 差异阈值（小时），超过才标记 |
| `--page <n>` | 分页页码 |
| `--page-size <n>` | 每页行数 |

### `atlas exec` — 批量执行

```bash
atlas exec --plan-file ./plan.json
```

见上方 [Agent 友好特性](#atlas-exec--批量执行计划文件) 章节。

### `atlas suggest` — 自然语言转命令

```bash
atlas suggest 查看今年第一季度的基线数据
atlas suggest --json                    # JSON 格式输出
```

### `atlas undo` — 撤销操作

撤销 `baseline fill --apply` 或 `baseline import --apply` 的执行结果：

```bash
# 列出最近的变更
atlas undo --list --limit 10

# 撤销指定操作
atlas undo <undoToken>
```

### `atlas daemon` — 守护进程模式

沙盒环境使用，保持持久浏览器会话：

```bash
atlas daemon
atlas daemon --port 9765
```

### `atlas schema` — 自省

```bash
# 导出字典和部门树
atlas schema export --out ./schema.json
atlas schema export --refresh    # 刷新缓存

# 列出所有命令参数定义
atlas schema commands --json
```

---

## 项目名的歧义处理

`--project-id` 接受数字 ID 或项目名称的精确名称/唯一子串。当匹配多个项目时，CLI 会以退出码 64 报错并列出所有候选。

Agent 处理方式：
1. **不要默认选第一个** — 项目搞错会查到错的人力数据
2. 将 CLI 列出的候选项目（含 ID 和完整名称）展示给用户
3. 用户指定后，**用数字 ID 重试**

## 过滤字段的模糊匹配

`--department` / `--role` / `--area-code` / `--mp-type` 是**子串过滤器**（不区分大小写），多匹配是 feature 而非错误。

Agent 行为约定：
1. 执行命令后**主动告诉用户**匹配到了哪几个部门/角色/地域
2. 如果匹配范围超出预期，**主动询问**是否需要更精确的子串

## 写入安全约定

1. **所有写入默认仅预览** — `fill` 和 `import` 需加 `--apply` 才实际执行
2. 先不带 `--apply` 运行，向用户展示变化的 diff
3. 获得用户明确确认后再加 `--apply`
4. 写入后可通过 `atlas undo` 撤销

## 推荐 Agent 工作流

1. **检查环境和会话**
   - 确认 `atlas` 命令可用（ `atlas --help` ）
   - `atlas auth status` — 若无会话，让用户运行 `atlas auth login`
   - 确认项目 ID（已有则用，否则 `atlas projects` 查找）

2. **读取数据展示给用户**
   - `atlas baseline month --project-id <id>` 是最常用命令
   - 需要高层汇总用 `atlas baseline summary`
   - 看实际工时用 `atlas actual ...`
   - 做对比用 `atlas compare`

3. **利用自省能力**
   - 不确定参数时：`atlas <command> --describe`
   - 想了解完整能力：`atlas schema commands --json`
   - 想查字典值：`atlas schema export`

4. **写入操作**
   - 模板 → `atlas baseline fill --template ... --out` → 展示 diff →  `--apply`
   - Excel → `atlas baseline import --file ...` → 展示列报告 → `--apply`
   - 出错 → `atlas undo <token>` 回滚

5. **错误处理**
   - 退出码 2（会话过期） → 让用户重跑 `atlas auth login`
   - 退出码 3（API 错误） → 展示 `errCode` + `errorMsg`，不要盲目重试
   - 退出码 64（配置错误） → 可能有 `details` 字段含候选列表
   - 网络 5xx → CLI 已有指数退避重试，持续失败则报告并中止