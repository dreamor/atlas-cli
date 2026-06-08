# Atlas CLI 命令重构计划

> 调整时间：2026-06-08
> 目标：命令结构清晰、基线与实际完全对称、项目搜索高频易用

---

## 五类命令总览

```
atlas
├── 1. 项目 (project)         项目发现、绑定、切换
├── 2. 基线 (baseline)        计划人力数据 CRUD
├── 3. 实际 (actual)          实际人力数据查询
├── 4. 比较 (compare)         基线 vs 实际对比
└── 5. 其他 (other)           认证/工具/辅助
```

---

## 1️⃣ 项目相关（Project）

| 命令 | 说明 |
|------|------|
| `atlas projects` *(NEW)* | 列出我有权限的所有项目 |
| `atlas find project <q>` *(原 resolve project)* | 搜索项目（精确/模糊/ID） |
| `atlas link [project]` | 绑定当前项目（精确名称/子串/数字ID） |
| `atlas unlink` | 解除项目绑定 |
| `atlas find department <q>` | 搜索部门 |
| `atlas find mp-type <q>` | 搜索人力类型 |
| `atlas find line-plan-type <q>` | 搜索计划类型 |
| `atlas find src-type <q>` | 搜索来源类型 |
| `atlas find area-code <q>` | 搜索地区编码 |

> `find` 替代原来的 `resolve`，语义更直观——"查找"比"解析"好理解。
> 项目搜索放在"项目"类别，因为这是最高频的查找场景。
> 非项目类的字典查找也归入此类，因为它们都服务于项目上下文。

---

## 2️⃣ 基线相关（Baseline）— 统一加 `baseline` 前缀

| 命令 | 说明 |
|------|------|
| `atlas baseline list` | 列出基线条目明细 |
| `atlas baseline show <itemId>` | 查看单条基线 |
| `atlas baseline month` | 按月查看基线投入 |
| `atlas baseline summary --by <axis>` | 按月/部门/角色多维汇总 |
| `atlas baseline export` | 导出基线数据（CSV/JSON） |
| `atlas baseline fill` | 模板批量填写基线 |
| `atlas baseline import` | 从文件导入基线 |

---

## 3️⃣ 实际相关（Actual）— 与基线完全对称

| 命令 | 说明 |
|------|------|
| `atlas actual list` | 实际工时明细（人员×周透视表） |
| `atlas actual show <staffId>` | 查看单个人员的实际工时明细 |
| `atlas actual month` | 按月查看实际人力投入 |
| `atlas actual summary --by <axis>` | 按月/部门/角色汇总实际工时 |
| `atlas actual export` | 导出实际工时数据（CSV/JSON） |

---

## 对齐对比

| 维度 | 基线命令 | 实际命令 |
|------|---------|---------|
| 明细列表 | `atlas baseline list` | `atlas actual list` |
| 单条查看 | `atlas baseline show <itemId>` | `atlas actual show <staffId>` |
| 按月汇总 | `atlas baseline month` | `atlas actual month` |
| 多维汇总 | `atlas baseline summary --by <axis>` | `atlas actual summary --by <axis>` |
| 导出 | `atlas baseline export` | `atlas actual export` |

两者共享 `--project-id`、`--from`、`--to`、`--department`、`--role`、`--status`（仅实际）、`--json` 等过滤选项。

---

## 4️⃣ 比较相关（Compare）

| 命令 | 说明 |
|------|------|
| `atlas compare` | 基线 vs 实际对比分析 |

支持选项：`--by`（month/department/role）、`--from`/`--to`、`--month`、`--department`、`--role`、`--status`、`--threshold`、`--flag-overrun`、`--page`/`--page-size`、`--json`

---

## 5️⃣ 其他（Other）

| 命令 | 说明 |
|------|------|
| `atlas auth login` | SSO 登录 |
| `atlas auth status` | 查看会话状态 |
| `atlas schema export` | 导出字典 + 部门树 |
| `atlas schema commands` | 列出所有命令参数 schema |
| `atlas daemon` | 启动守护进程（沙盒环境） |
| `atlas undo [token]` | 回滚 fill 操作 |
| `atlas exec --plan-file <path>` | 按计划文件批量执行 |
| `atlas suggest <query>` | 自然语言→atlas 命令翻译 |

---

## 源文件目录结构调整

```
adapters/atlas/
├── cli.ts                        ← 瘦身：仅 buildProgram + register* 调用
├── commands/
│   ├── project/
│   │   ├── index.ts              ← 统一导出
│   │   ├── projects.ts           ← NEW: 列出我的项目
│   │   ├── link.ts               ← 已存在
│   │   ├── unlink.ts             ← 已存在
│   │   └── find.ts               ← NEW: 替代 resolve.ts（项目+字典搜索）
│   ├── baseline/
│   │   ├── index.ts              ← 统一导出
│   │   ├── list.ts               ← 原 list.ts
│   │   ├── show.ts               ← 原 show.ts
│   │   ├── month.ts              ← 原 month.ts
│   │   ├── summary.ts            ← 原 summary.ts
│   │   ├── export.ts             ← 原 export.ts（仅保留 baseline 逻辑）
│   │   ├── fill.ts               ← 原 fill.ts
│   │   └── import.ts             ← 原 import.ts
│   ├── actual/
│   │   ├── index.ts              ← 统一导出
│   │   ├── list.ts               ← NEW: 从原 actual.ts 拆分明细逻辑
│   │   ├── show.ts               ← NEW: 查看单个人员工时明细
│   │   ├── month.ts              ← NEW: 从原 actual.ts 拆分按月视图
│   │   ├── summary.ts            ← NEW: 从原 actual.ts 拆分汇总逻辑
│   │   └── export.ts             ← NEW: 从原 export.ts 拆分 actual 导出
│   ├── compare/
│   │   ├── index.ts              ← 统一导出
│   │   └── compare.ts            ← 原 compare.ts
│   └── util/
│       ├── exec.ts               ← 不变
│       ├── suggest.ts            ← 不变
│       ├── schema.ts             ← 不变
│       └── undo.ts               ← 不变
├── auth/
│   └── index.ts                  ← 统一导出 auth login/status
├── daemon/
│   └── index.ts                  ← 统一导出 daemon
└── dict/                         ← 不变
```

---

## `cli.ts` 重构方案

```typescript
// buildProgram() 精简为注册五类子函数

function buildProgram(): Command {
  const program = new Command()
    .name('atlas')
    .description('Atlas CLI - 斑马云图人力基线管理工具')
    // ... 全局选项不变 ...

  registerAuthCommands(program);          // auth login/status
  registerProjectCommands(program);       // find, projects, link, unlink
  registerBaselineCommands(program);      // list, show, month, summary, export, fill, import
  registerActualCommands(program);        // list, show, month, summary, export
  registerCompareCommands(program);       // compare
  registerUtilityCommands(program);       // daemon, schema, undo, exec, suggest

  return program;
}
```

---

## 实施步骤

| 阶段 | 任务 | 改动范围 | 风险 |
|------|------|---------|------|
| **Phase 1** | 创建 `commands/project/find.ts`、目录拆分、`cli.ts` 注册函数拆分 | 纯重构，不改命令行为 | 低 |
| **Phase 2** | 命令重命名（`list`→`baseline list` 等） | 需更新所有 import、测试、文档 | 中 |
| **Phase 3** | `actual` 拆分（`actual list/show/month/summary/export`） | 从原 actual.ts 和 export.ts 拆分 | 中 |
| **Phase 4** | `export` 拆分（`baseline export` + `actual export`） | 从原 export.ts 分离 actual 逻辑 | 中 |
| **Phase 5** | `projects` 新命令 | 需要调用项目列表 API | 高（依赖 API） |
| **Phase 6** | 更新 CLI_USAGE.md + 测试 | 全文档 + 全测试 | 低 |

---

## 注意事项

1. **`actual show` 参数**：基线 `show` 接受 `itemId`（条目ID），实际 `show` 接受 `staffId`（人员ID），因为实际数据按人员组织，不是按条目。
2. **`actual month` 语义**：现有 `actual` 不带 `--by` 时默认就是按月明细（人员×周），拆分后 `actual month` 专注"本月各人投入"的月度视图。
3. **向后兼容**：Phase 2 重命名后，旧命令名全部失效。建议同步升级所有测试和文档。
4. **`addProjectOptions` 范围**：`find` 系列和 `projects` 命令如果需要 `--project-id`，需手动添加。