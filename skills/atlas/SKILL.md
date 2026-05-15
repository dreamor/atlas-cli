---
name: atlas
description: 通过 CLI 读写斑马云图人力基线项目数据。当用户想要列出/导出/编辑条目、查看人力基线汇总、按月/部门/角色汇总人力、从 Excel 批量导入人力或生成模板化更新时使用此技能。
---

# 斑马云图人力基线 CLI

薄 TypeScript CLI 层，封装斑马云图 `yuntu-service` API 用于
mpLine 场景（`/projects/mpLine/list?projectId=<id>`）。通过
有头 Playwright 浏览器完成一次 BUC SSO 认证，然后为每次
后续 HTTP 调用重放 cookie + `x-banma-*` 请求头。

## 使用场景

在用户想要执行以下操作时调用此技能：
- **列出/导出** 项目中的条目
- **查看** 单个条目详情
- **month** — 按（部门、角色、备注）分组的月度人力透视表（人力基线汇总）
- **summary** — 按月/部门/角色汇总人力
- **fill** — 通过 Nunjucks/Jinja 模板批量更新条目（或通过 `--target month` 更新月度数据，可选 LLM 辅助）
- **import** — 从 `.xlsx` 或 `.csv` 文件批量导入月度人力数据
- 通过缓存的字典/部门树查看项目元数据

**禁止**将此用于 RFT 任务、PMP 工单、Aone 代码或任何非 mpLine
场景 — 适配器按设计仅限于 mpLine 表面。

## 前置条件

每次使用此 skill 前，按顺序执行：

1. **运行 bootstrap（幂等，已就绪时秒退）**
   ```bash
   bash scripts/bootstrap.sh
   ```
   该脚本会确保 atlas 二进制、Node ≥ 20、playwright + chromium 都已安装到
   `$ATLAS_HOME`（默认 `~/.atlas`）。**首次运行**会下载约 260 MB
   并提示确认；非交互场景设 `ATLAS_BOOTSTRAP_YES=1`。
   - 仅做只读命令（list / month / summary / export）可设 `ATLAS_SKIP_PLAYWRIGHT=1` 跳过浏览器依赖。
   - 已 clone 仓库且 `npm install` 完成的开发环境会被自动识别，bootstrap 可跳过。

2. **验证会话**：`atlas auth status`
   - 无会话或失效 → 运行 `atlas auth login`（会打开浏览器，Agent 无法解决 2FA，
     需要让用户介入）。
   - 会话保存在 macOS Keychain（服务 `atlas`，账户 `default`）或文件兜底，
     直到 BUC 令牌过期。

3. **有效的项目 ID**（如 `2548`）— 通过 `--project-id` 参数或 `BANMA_PROJECT_ID`
   环境变量指定。

任一检查失败则中止并报告具体缺失的前置条件，**不要跳过 bootstrap**。

## 安全约定

- **写入默认仅预览**。`fill` 和 `import` 仅暂存/验证，直到
  添加 `--apply` 才实际执行。先不带 `--apply` 运行并向用户
  展示将会有什么变化。
- **永不绕过 SSO 或存储密码**。会话仅为 BUC cookie +
  `x-banma-*` 载体镜像。无会话则 CLI 拒绝运行。
- **每次调用仅操作一个项目**。需要 `--project-id`；永不
  在单次调用中跨项目变更。

## 沙盒环境支持

在沙盒环境中运行（如 Claude Code 沙盒）时，文件系统访问受限：

1. **先启动守护进程**：
   ```bash
   atlas daemon --port 8765
   ```
   这将打开浏览器进行 SSO 登录。登录后，cookie 保存在内存中。

2. **正常使用 CLI** - CLI 会自动检测沙盒并使用守护进程：
   ```bash
   atlas list --project-id 2548
   atlas month --project-id 2548 --area-code BSH
   ```

守护进程保持浏览器会话活跃，用户只需登录一次。

## 自然语言查询

用户用自然语言提问时，你应该：
1. 解析意图并提取：项目、部门、角色、时间范围
2. 转换为 CLI 参数：--project-id、--department、--role、--from、--to
3. 执行命令并展示结果

示例：
- "帮我看看产品部门2025年的人力" → `month --project-id <id> --department 产品 --from 2025-01 --to 2025-12`
- "show me the headcount for algorithm team this year" → `month --project-id <id> --role 算法 --from 2026-01 --to 2026-12`
- "今年各部门每个月投入多少人" → `summary --project-id <id> --by department --from 2026-01 --to 2026-12`
- "导出产品部的数据到文件" → `export --project-id <id> --department 产品 --format csv --out <path>`

## 核心命令

### 会话

```bash
atlas auth login
atlas auth status
```

- `auth login` 打开有头 Chromium，用户完成 BUC + 2FA 后，CLI
  从 `/user/info` 提取 cookie + `(empId, account, bucToken, ua)` 并
  通过 `keytar` 持久化。
- `auth status` 打印当前会话（empId、cookie 数量、保存时间）。

### 读取

```bash
atlas list     --project-id 2548 [--json] [--page N] [--page-size N]
atlas show     <itemId> --project-id 2548 [--json]
atlas month    --project-id 2548 [--json] [--department <s>] [--role <s>] [--from YYYY-MM] [--to YYYY-MM]
atlas summary  --project-id 2548 [--by month|department|role] [--from YYYY-MM] [--to YYYY-MM] [--json]
atlas export   --project-id 2548 --format csv|json --out <path> [--since <iso>]
```

- `list` POST `/yuntu-service/line/plan/select.json` 带 `{projectId}`，
  并渲染表格，`mpType` / `linePlanType` / `srcType` /
  `departmentId` 通过缓存字典解析（24 h TTL，
  `~/.cache/atlas/`）。这是**稀疏基表**（仅元数据，无逐月人力）。
- `month` POST `/yuntu-service/line/plan/month/select.json` 并透视结果：
  行 = (department, role, remark)，列 = 月份 (YYYY-MM)，单元格 = 人力。
  这是**滚动人力基线**用户实际关心的 — 当问题是关于
  月度人力数字时使用此命令而非 `list`。
- `summary` 将同样的 `month/select` 数据聚合为所选维度的单一数字
  （月/部门/角色）。适用于高层汇总。
- `show <id>` 目前在客户端过滤列表（尚无原生详情端点）。
  可接受，因为 `line/plan/select.json` 一次性返回项目中全部数据。
- `export` 写入 CSV 或 JSON。`parquet` 尚未实现。

### 写入（默认仅预览）

```bash
# fill: 渲染每行 Nunjucks/Jinja 模板，暂存更新，审查，然后应用
atlas fill \
  --project-id 2548 \
  --template ./examples/template.j2 \
  --out /tmp/fill.json \
  [--llm claude-sonnet-4-5]

# 审查 /tmp/fill.json 后，应用：
atlas fill \
  --project-id 2548 \
  --template ./examples/template.j2 \
  --out /tmp/fill.json \
  --apply

# import: 从 xlsx/csv 批量上传月度人力
atlas import \
  --project-id 2548 \
  --file ./examples/sample.xlsx
# 预览打印表头 + 行数 + 缺失/多余列。

atlas import \
  --project-id 2548 \
  --file ./examples/sample.xlsx \
  --apply
```

- `fill` 可选 `--llm <model>` 将渲染后的模板路由通过 Claude
  （需要 `ANTHROPIC_API_KEY` 环境变量）生成更丰富的更新负载。
- `import` 必填列：`projectId, mp, areaCode, mpType, departmentId, linePlanType, month, value`。
  若列不匹配，预览会警告 `missing` / `extra`。仅 xlsx 发送
  到服务器（csv 本地先转换）。
- 两个命令仅在 `--apply` 时 POST 到
  `/yuntu-service/line/plan/save.json?projectId=<id>`（fill）或
  `/yuntu-service/line/plan/month/import.json` 多部分（import）。

## 推荐 Agent 工作流

1. **检查会话**。运行 `auth status`。若无会话，中止并让用户
   运行 `auth login`（它会打开浏览器 — Agent 无法解决 2FA）。
2. **始终先用 `list` 或 `export --format json`** 向用户展示
   当前状态再提出变更。
3. **模板化更新**：向用户要模板路径或在 `examples/` 起草一个，
   然后 `fill ... --out` → 展示暂存差异 → 询问后再 `--apply`。
4. **Excel 导入**：先预览，显示列报告，若列不匹配则修复表格，
   然后 `--apply` 并明确获得用户同意。
5. **错误**：
   - `SessionExpiredError` → 会话失效，让用户重新运行 `auth login`。
   - `BanmaApiError` 带 `errCode` / `errorMsg` → 展示给用户；不要
     盲目重试。
   - 网络 / 5xx → 客户端已带指数退避重试；若仍失败，报告并中止。

## 文件布局（调试参考）

- `adapters/atlas/cli.ts` — Commander 入口
- `adapters/atlas/auth/` — Playwright 登录 + keytar 会话
- `adapters/atlas/http/client.ts` — undici 客户端，信封解包
- `adapters/atlas/schema/` — zod 模型（`LinePlan`、`Envelope`…）
- `adapters/atlas/commands/` — `list`、`show`、`export`、`fill`、`import`、`auth`
- `adapters/atlas/dict/` — 字典 + 部门缓存
- `docs/recon/mpline.md` — 端点目录 + 认证模型 + 写入契约
- `prompts/atlas-cli.md` — 原始 RISEN 规范
- `examples/template.j2`、`examples/sample.xlsx` — 参考输入

## 已知限制

- **无原生单条详情端点**。`show` 在客户端过滤列表。可以接受，
  因为 `line/plan/select.json` 一次返回项目中全部数据。
- **未观察分页**。后端可能接受 `pageNum` / `pageSize`
  （存在向前兼容标志）但尚未针对大项目确认。若遇到数千行，
  假设单次获取可以之前先与用户确认。
- **Parquet 导出** 是 `NotImplementedError` — 故意跳过重量依赖。
- **字典/部门缓存** 有 24 h TTL。传递 `--refresh-dictionary`
  （TODO，尚未接入）或删除 `~/.cache/atlas/` 强制刷新。
- **写入端点**（`save`、`delete`、`import`）通过
  SPA 包静态分析发现，而非运行时捕获。`save` 的确切请求体
  形状是推断的；在批量操作前先用低风险项目确认一次 `--apply`。

## Agent 调用模板

```
cd /Users/scottwang/Documents/Workspace/Atlas-Cli
atlas <command> [options]
```

始终前缀 `cd` 使 Keychain 会话路径解析生效。CLI 任何错误则
非零退出；声明成功前检查退出码。