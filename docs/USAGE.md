# Banma mpLine CLI — 操作说明

> 仓库: `/Users/scottwang/Documents/Workspace/Atlas-Cli`
> 入口: `atlas <command>`
> 安全: 写命令默认 dry-run，必须显式 `--apply` 才落库

---

## 0. 一次性准备

```bash
cd /Users/scottwang/Documents/Workspace/Atlas-Cli
npm install
npm run build      # 产出 dist/
npm link           # 注册全局命令 atlas
atlas auth login
# Chromium 自动弹出 → 完成 BUC SSO + 2FA → session 自动存到 macOS Keychain
```

之后 BUC token 没过期前都不用再登录（session 持久化在 Keychain
`service=atlas, account=default`）。

可选：

```bash
export BANMA_PROJECT_ID=2548   # 这样后续命令可以省略 --project-id
```

---

## 1. 命令速查

| 命令 | 用途 | 是否写库 |
|---|---|---|
| `auth login` | 一次性 SSO 登录 | 否 |
| `auth status` | 查看当前会话 | 否 |
| `list` | 列项目内稀疏 LinePlan（`line/plan/select`） | 否 |
| `show <id>` | 单条详情 | 否 |
| `month` | 月度人力基线汇总透视表（`line/plan/month/select`） | 否 |
| `summary` | 按 月 / 部门 / 角色 汇总月度人力 | 否 |
| `export` | 批量导出 csv/json | 否 |
| `fill` | 用模板批量改字段（dry-run）/ `--apply` 落库；支持 `--target lineplan\|month` | dry-run 默认；`--apply` 写 |
| `import` | xlsx/csv 批量导入月度（dry-run）/ `--apply` 落库；`--target month` 默认 | dry-run 默认；`--apply` 写 |

通用选项：`--project-id <id>`（必填或环境变量）、`--json`（结构化输出）、
`-h/--help`。

---

## 2. 常用流程

### 2.1 看一下项目里有什么

```bash
atlas list --project-id 2548
# 表格：ID | MP | mpType | linePlanType | srcType | department | area | changeTime

atlas list --project-id 2548 --json
# 给脚本/agent 用
```

### 2.2 看单条

```bash
atlas show 346 --project-id 2548
atlas show 346 --project-id 2548 --json
```

### 2.3 看月度人力基线（month / summary）

`list` 走的是稀疏的 `line/plan/select`（只有元数据），看月份人力得用
`month` / `summary`，对应富版的 `line/plan/month/select`。

```bash
# 透视表：行 = (部门, 角色, 备注)，列 = 月份
atlas month --project-id 2548

# 只看某部门、某角色、某月窗口
atlas month --project-id 2548 \
  --department 算法 \
  --role 产品 \
  --from 2025-01 --to 2025-06

# 给脚本用
atlas month --project-id 2548 --json
```

按月 / 部门 / 角色汇总：

```bash
atlas summary --project-id 2548                       # 默认 --by month
atlas summary --project-id 2548 --by department
atlas summary --project-id 2548 --by role --json
atlas summary --project-id 2548 --by month --from 2025-01 --to 2025-06
```

### 2.4 导出

```bash
# CSV
atlas export --project-id 2548 \
  --format csv --out ~/Desktop/mpline-2548.csv

# JSON
atlas export --project-id 2548 \
  --format json --out ~/Desktop/mpline-2548.json

# 增量（只导 ISO 时间之后修改过的）
atlas export --project-id 2548 \
  --format json --since 2026-05-01T00:00:00Z --out /tmp/recent.json
```

> Parquet 暂未实现（占位会报 `NotImplementedError`）。

### 2.5 用模板批量改字段（fill）

**模板**用 [Nunjucks](https://mozilla.github.io/nunjucks/) 语法，每条 LinePlan
作为 `row` 注入。模板必须输出**合法 JSON 对象**，CLI 会 merge 进 update payload。

示例 `examples/template.j2`：

```jinja
{
  "id": {{ row.id }},
  "areaCode": "{{ row.areaCode }}",
  "mp": "",
  "mpType": 1,
  "remark": "auto-filled for project {{ row.projectId }}"
}
```

**第 1 步：dry-run，stage 到文件**

```bash
atlas fill \
  --project-id 2548 \
  --template ./examples/template.j2 \
  --out /tmp/fill.json
```

输出：

```
mode: dry-run
rows considered: 1
rows staged: 1
rows skipped: 0
stage: /tmp/fill.json
Re-run with --apply to commit updates.
```

**第 2 步：人工审 `/tmp/fill.json`**

```bash
cat /tmp/fill.json | jq .
```

**第 3 步：确认无误 → `--apply` 落库**

```bash
atlas fill \
  --project-id 2548 \
  --template ./examples/template.j2 \
  --out /tmp/fill.json \
  --apply
```

> `--apply` 会读你刚 stage 的文件，POST 到 `/yuntu-service/line/plan/save.json?projectId=<id>`。

**可选：用 LLM 二次生成字段**

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
atlas fill \
  --project-id 2548 \
  --template ./examples/template.j2 \
  --llm claude-sonnet-4-5 \
  --out /tmp/fill.json
```

模板渲染结果会作为 prompt 喂给 Claude，Claude 返回的 JSON 会 merge 到 update。

### 2.6 从 Excel 批量导入月度人力（import）

**接口期望的列**（8 个，缺一不可）：

```
projectId, mp, areaCode, mpType, departmentId, linePlanType, month, value
```

**第 1 步：dry-run 校验列**

```bash
atlas import \
  --project-id 2548 \
  --file ~/Desktop/my-month-data.xlsx
```

输出：

```
mode: dry-run
sheet: Sheet1
data rows: 24
headers (8): projectId, mp, areaCode, mpType, departmentId, linePlanType, month, value
missing columns: (none)
extra columns: (none)
Re-run with --apply to upload.
```

如果 `missing` 有内容，先去 Excel 改表头再回来。

**第 2 步：确认列匹配 → 上传**

```bash
atlas import \
  --project-id 2548 \
  --file ~/Desktop/my-month-data.xlsx \
  --apply
```

> `.csv` 也支持，会本地转成 `.xlsx` 再 multipart POST 到
> `/yuntu-service/line/plan/month/import.json`。`--target month` 是默认，
> 也是当前唯一接通的 import 通道；`--target lineplan` 暂未实现，会显式报错。

`fill` 也提供 `--target month`，把模板套到月度行（`line/plan/month/select`）
并 POST 到 `line/plan/month/save.json`，用于按 (部门, 角色) 整行覆盖月度人力：

```bash
atlas fill --project-id 2548 \
  --target month \
  --template ./examples/month-template.j2 \
  --out /tmp/fill-month.json
# 审完 --apply
```

---

## 3. 错误码

| rc | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用错误（文件不存在、网络失败等） |
| 2 | 业务异常（id 不存在、服务端 envelope `success=false`） |
| 64 | 配置错误（缺 `--project-id`、参数非法、parquet 未实现） |

会话过期会报 `SessionExpiredError`，重新跑 `auth login` 即可。

---

## 4. 给 Claude Code agent 用

skill 已经打包在 `skills/atlas/SKILL.md`。

**怎么让 agent 用上：**

把 `skills/atlas/` 整个拷到 `~/.claude/skills/atlas/`（或加到
你的 skill 加载路径），然后在 chat 里直接说：

- "用 atlas 列项目 2548 的 LinePlan"
- "把 id=346 那条的 mp 改成 1.5（dry-run 先看下）"
- "从 ~/Desktop/data.xlsx 导入到项目 2548"

agent 会自动遵守 dry-run 安全契约（`fill`/`import` 默认不写、要你确认才 `--apply`）。

---

## 5. 故障排查

```bash
# 会话过期或丢失
atlas auth login

# Keychain 里手动看 session
security find-generic-password -s atlas -a default -w

# Dictionary 缓存过时（24h TTL）
rm -rf ~/.cache/atlas/

# 直接打 XHR 看 raw 响应（调试用）
npx tsx scripts/debug-list.ts 2548

# 重抓站点端点（如服务端改了 API）
npm run recon -- --project-id 2548   # 浏览器 + HAR 录制
npx tsx scripts/static-recon.ts       # 静态扫 SPA bundle
```

---

## 6. 项目结构

```
adapters/atlas/
├─ cli.ts                    # commander 入口
├─ auth/                     # Playwright 登录 + keytar 持久化
├─ http/client.ts            # undici 客户端 + envelope unwrap
├─ schema/                   # zod LinePlan / Envelope / ...
├─ commands/                 # auth / list / show / export / fill / import
├─ dict/                     # dictionary + department 本地缓存
└─ util/                     # paths / errors / projectId

docs/recon/mpline.md         # 端点清单 + 鉴权模型
prompts/atlas-cli.md  # 原 RISEN 规范
skills/atlas/         # 给 Claude agent 用的 skill 包
examples/template.j2         # fill 的 Nunjucks 模板示例
examples/sample.xlsx         # import 的列模板示例
scripts/                     # recon / debug 工具
tests/                       # vitest 单测（38 个）
```
