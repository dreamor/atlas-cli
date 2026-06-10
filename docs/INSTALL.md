# Atlas CLI 安装与使用指南

Atlas CLI 是斑马云图（Banma Yuntu）的人力基线管理命令行工具，用于管理项目人力投入数据（基线/实际/对比）。

---

## 目录

1. [安装前提](#1-安装前提)
2. [一键安装（推荐）](#2-一键安装推荐)
3. [认证登录](#3-认证登录)
4. [快速开始](#4-快速开始)
5. [命令参考](#5-命令参考)
6. [常见问题](#6-常见问题)

---

## 1. 安装前提

### 支持平台

| 平台 | 架构 | 支持 |
|------|------|------|
| macOS | Intel (x64) | ✅ |
| macOS | Apple Silicon (arm64) | ✅ |
| Linux | x86_64 | ✅ |
| Linux | ARM64 | ✅ |
| Windows | x86_64 | ✅ |

---

## 2. 一键安装（推荐）

安装脚本自动处理所有依赖：CLI 二进制 + Node.js ≥ 20 + npm/npx + Playwright + Chromium。

### macOS / Linux

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.sh)
```

### Windows

```cmd
:: PowerShell（自动检测）
curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.bat | cmd
```

或直接使用 PowerShell：

```powershell
iwr -useb https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.ps1 | iex
```

### 安装过程

安装脚本会依次完成：

1. **下载 atlas 二进制**（~60MB）到 `~/.atlas/bin/atlas`
2. **检测 Node.js** — 如果系统 Node < 20，自动下载并安装 Node 20.18.0 到 `~/.atlas/runtime/node`
3. **安装 Playwright + Chromium**（~150MB）到 `~/.atlas/lib/`（仅 `auth login` 和 `daemon` 需要）
4. 输出安装完成信息和后续指引

### 安装后配置

**macOS / Linux** — 将 `atlas` 添加到 PATH（安装脚本会提示，或手动添加到 shell rc 文件）：

```bash
# ~/.zshrc / ~/.bashrc
export PATH="$HOME/.atlas/bin:$PATH"
export ATLAS_HOME="$HOME/.atlas"
```

**Windows** — 将 `atlas` 添加到系统 PATH：

```powershell
# PowerShell（以管理员运行）
[Environment]::SetEnvironmentVariable("Path", "$env:USERPROFILE\.atlas\bin;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")
[Environment]::SetEnvironmentVariable("ATLAS_HOME", "$env:USERPROFILE\.atlas", "User")
```

或通过系统设置 > 高级系统设置 > 环境变量 > 用户变量，新建：
- 变量名：`Path`，值：追加 `%USERPROFILE%\.atlas\bin`
- 变量名：`ATLAS_HOME`，值：`%USERPROFILE%\.atlas`

验证安装：

```bash
atlas --help
```

### 安装环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ATLAS_HOME` | `~/.atlas` | 安装根目录 |
| `ATLAS_RELEASE_TAG` | `latest` | 指定 GitHub Release 版本标签 |
| `GH_REPO` | `dreamor/atlas-cli` | GitHub 仓库（fork 时修改此项） |
| `NODE_VERSION` | `20.18.0` | 下载的 Node.js 版本 |
| `NODE_MIRROR` | `https://nodejs.org/dist` | Node.js 镜像地址 |
| `PLAYWRIGHT_VERSION` | `1.49.0` | Playwright 版本 |
| `PLAYWRIGHT_DOWNLOAD_HOST` | （无） | Chromium 镜像地址（离线环境使用） |
| `ATLAS_BOOTSTRAP_YES` | （无） | 设为 `1` 跳过大小确认提示（非交互式） |
| `ATLAS_SKIP_PLAYWRIGHT` | （无） | 设为 `1` 跳过 Playwright + Chromium 安装 |

### 安装目录结构

```
~/.atlas/
├── bin/
│   ├── atlas          # Atlas CLI 二进制
│   ├── npm -> ...     # 如果安装了捆绑 Node，会链接 npm
│   └── npx -> ...     # 如果安装了捆绑 Node，会链接 npx
├── runtime/
│   └── node/          # 如果系统 Node < 20，此处安装捆绑 Node
└── lib/
    └── node_modules/
        └── playwright/  # 如果未跳过 Playwright，此处安装
```

---

## 3. 认证登录

Atlas CLI 通过 BUC SSO（浏览器登录）完成认证。

```bash
# 1. 检查认证状态
atlas auth status

# 2. 登录（会打开浏览器窗口）
atlas auth login
```

登录过程：
- 命令会打开 Chromium 浏览器窗口，跳转到斑马云图 SSO 登录页
- **SSO + OTP 双因子认证需要您在浏览器中手动完成**
- 登录成功后终端会提示，浏览器窗口自动关闭

会话存储位置：
- `~/.config/atlas/session.json`（权限 600，仅当前用户可读）
- macOS 还会额外存入系统 Keychain（通过 keytar）

```bash
# 查看认证状态（JSON 格式）
atlas auth status --json
# 输出：{ "ok": true, "data": { "authenticated": true, "account": "...", "empId": "..." } }
```

---

## 4. 快速开始

### 第一步：确定项目

```bash
# 列出你有权限的所有项目
atlas projects

# 绑定项目（后续命令无需再传 --project-id）
atlas link <项目名称或ID>

# 查看当前绑定的项目
atlas link
```

### 第二步：指定项目 ID（三选一）

```bash
# 方式1：命令行参数（优先级最高）
atlas baseline month --project-id 2548

# 方式2：环境变量
## macOS / Linux
export BANMA_PROJECT_ID=2548
atlas baseline month
## Windows PowerShell
$env:BANMA_PROJECT_ID=2548; atlas baseline month

# 方式3：绑定项目（优先级最低）
atlas link 斑马智行车载OS项目
```

### 第三步：开始查看数据

```bash
# 查看基线人力月度汇总
atlas baseline month

# 指定月份范围
atlas baseline month --from 2025-01 --to 2025-06

# 按部门过滤
atlas baseline month --department 研发部

# 查看实际工时
atlas actual month --month 2025-04

# 基线 vs 实际对比
atlas compare
```

### 数据单位说明

| 概念 | 英文 | 单位 | 说明 |
|------|------|------|------|
| **基线** | Baseline | 人月 | 计划/预测的人力投入 |
| **实际** | Actual | 人月 | API 直接返回人月，无需转换 |
| **对比** | Compare | 人月 | 基线与实际均以人月对比 |

所有 API 时间戳均为 **CST（UTC+8）** 时区。日期参数统一格式：`YYYY-MM`（如 `2025-01`）。

---

## 5. 命令参考

### 全局选项

| 选项 | 说明 |
|------|------|
| `--help` | 查看命令帮助 |
| `--json` | JSON 信封格式输出（也可通过 `ATLAS_OUTPUT=json` 或 `ATLAS_JSON=1` 环境变量启用） |
| `--describe` | 查看命令的参数定义，不执行命令 |

### 认证

```bash
atlas auth login      # 打开浏览器完成 SSO 登录
atlas auth status     # 查看认证状态
```

### 项目

```bash
atlas projects                     # 列出所有项目
atlas find project <关键词>        # 搜索项目
atlas find department <关键词>     # 搜索部门
atlas link [项目]                  # 绑定/查看绑定项目
atlas unlink                       # 解绑项目
```

### 基线人力（人月）

```bash
# 月度汇总（最常用）
atlas baseline month                               # 全部月份
atlas baseline month --month 2025-01               # 单月
atlas baseline month --from 2025-01 --to 2025-06   # 范围

# 多维汇总
atlas baseline summary --by month
atlas baseline summary --by department --from 2025-01 --to 2025-06

# 导出
atlas baseline export --format csv --out ./baseline.csv
atlas baseline export --format json --out ./baseline.json

# 模板批量填充（写入，默认仅预览）
atlas baseline fill --template ./template.njk --out ./preview.json
atlas baseline fill --template ./template.njk --apply

# 导入 xlsx/csv（写入，默认仅预览）
atlas baseline import --file ./data.xlsx
atlas baseline import --file ./data.xlsx --apply
```

### 实际工时

```bash
# 月度明细
atlas actual month --month 2025-05
atlas actual month --from 2025-01 --to 2025-06

# 单人明细
atlas actual show <staffId> --month 2025-05

# 多维汇总
atlas actual summary --by month
atlas actual summary --by department

# 导出
atlas actual export --format csv --out ./actuals.csv
```

### 对比分析

```bash
# 按月对比（实际 vs 基线，均以人月）
atlas compare

# 按部门/角色汇总
atlas compare --by department
atlas compare --by role

# 标记超支
atlas compare --flag-overrun
atlas compare --threshold 40
```

### 工具命令

```bash
atlas suggest 查看今年第一季度的基线数据    # 自然语言转命令
atlas exec --plan-file ./plan.json          # 批量执行计划文件
atlas undo --list --limit 10               # 列出最近的变更
atlas undo <token>                         # 撤销操作
atlas schema export --out ./schema.json    # 导出字典数据
atlas schema commands --json               # 列出所有命令定义
```

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 通用错误 / exec 中某步骤失败 |
| 2 | 会话过期（需重新登录） |
| 3 | API 返回错误 |
| 64 | 配置错误 / 未实现 |

### 过滤参数

以下参数适用于大部分数据命令：

| 参数 | 说明 |
|------|------|
| `--project-id <id>` | 项目 ID（数字或名称） |
| `--from YYYY-MM` | 起始月份 |
| `--to YYYY-MM` | 截止月份 |
| `--department <s>` | 部门名称子串过滤（不区分大小写） |
| `--role <s>` | 角色名称子串过滤 |
| `--area-code <s>` | 地域代码过滤 |
| `--mp-type <s>` | 人力类型过滤 |

---

## 6. 常见问题

### `command not found: atlas`

**macOS / Linux** — 添加以下内容到 shell rc 文件并重启终端：

```bash
export PATH="$HOME/.atlas/bin:$PATH"
```

**Windows** — 添加 `%USERPROFILE%\.atlas\bin` 到用户 PATH 环境变量（见上方"[安装后配置](#安装后配置)"），然后**重新打开**终端窗口。

### `auth` 相关命令失败

Playwright + Chromium 未安装。检查安装时是否设置了 `ATLAS_SKIP_PLAYWRIGHT=1`，如果是，可重新运行安装脚本（不加跳过变量）或手动安装 Playwright：

```bash
# 使用安装脚本捆绑的 npm
~/.atlas/bin/npm install playwright
~/.atlas/lib/node_modules/.bin/playwright install chromium
```

### 会话过期

当命令返回退出码 `2` 时，表示会话已过期：

```bash
atlas auth login    # 重新登录
```

### API 返回错误

退出码 `3` 表示斑马云图 API 返回了错误。查看错误详情：

```bash
atlas baseline month --json    # JSON 输出中会包含 errCode / errorMsg
```

### 如何升级

重新运行一键安装脚本即可自动更新到最新版本（脚本是幂等的——只会更新需要更新的部分）：

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.sh)
```

```powershell
# Windows PowerShell
iwr -useb https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.ps1 | iex
```

### macOS Gatekeeper 警告

首次运行 atlas 二进制时，macOS 可能会弹出安全警告。安装脚本已自动移除 quarantine 属性，如果仍遇到，可手动执行：

```bash
xattr -d com.apple.quarantine ~/.atlas/bin/atlas
```

### 隐私说明

- CLI 仅通过 HTTPS 与斑马云图 `yuntu-service` API 通信
- 会话信息存储在本地文件系统（`~/.config/atlas/session.json`，权限 600）和 macOS Keychain
- 项目数据不会上传到任何第三方服务