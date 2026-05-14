# Bun 单文件分发（实验性）

本文档说明如何用 [Bun](https://bun.sh) 把 Atlas CLI 编译为单文件可执行二进制，便于跨平台分发。**不影响现有 `npm run build` (tsc) 流程**。

## 背景

`tsc` 产物需要用户机器安装 Node ≥ 20，并保留 `node_modules`。Bun 的 `bun build --compile` 可以把运行时 + 源码 + 依赖打成一个 ~50–90 MB 的二进制，支持 mac / linux / windows 交叉编译，用户 `curl` 下来直接执行。

## 前置

```bash
# 安装 bun（仅打包者需要）
curl -fsSL https://bun.sh/install | bash
```

## 命令

| 脚本 | 说明 |
| ---- | ---- |
| `npm run build:bun` | 编译当前平台二进制到 `dist-bun/atlas` |
| `npm run build:bun:mac-arm64` | macOS Apple Silicon |
| `npm run build:bun:mac-x64` | macOS Intel |
| `npm run build:bun:linux-x64` | Linux x86_64 |
| `npm run build:bun:linux-arm64` | Linux ARM64 |
| `npm run build:bun:win-x64` | Windows x64（产物为 `.exe`） |
| `npm run build:bun:all` | 一次性产出全部平台二进制 |
| `npm run verify:bun` | 跑 `./dist-bun/atlas --help` 验证 |

## 外部依赖（--external）

以下包**不会**被打进二进制，因为它们带原生模块或大量浏览器二进制：

- `keytar`：N-API 原生模块，Bun 编译产物加载原生 `.node` 文件有兼容性风险。若用户需要 keychain 存 session，由 `auth/session.ts` 现有的"keytar 不可用时降级文件存储"逻辑兜底。
- `playwright` / `playwright-core`：仅 `auth login` 走浏览器登录时需要；二进制场景下，登录流程建议用户在有 Node 的环境里跑一次 `npm run auth:login` 拿到 session，之后日常命令用编译产物即可。

## 已知限制

1. **首次未验证**：本 PR 仅落地构建脚本和 CI，**尚未在所有平台跑通**。需要在合并前至少验证 `mac-arm64` 产物能 `--help` 并执行一个只读命令（如 `atlas list`）。
2. **二进制体积大**：单文件 50–90 MB，比 `tsc` 产物 + npm install 大很多，但用户侧零依赖。
3. **Playwright 缺失时的 `auth login`**：编译产物运行 `atlas auth login` 会因找不到 playwright 报错——这是设计决定，参见上方"外部依赖"说明。后续可在 `commands/auth.ts` 加更友好的提示。
4. **macOS Gatekeeper**：用户首次运行可能被 Gatekeeper 拦截，需要 `xattr -d com.apple.quarantine ./atlas` 或在 release 流程里做 codesign + notarize。

## 验证清单（合并前）

- [ ] `bun --version` ≥ 1.1
- [ ] `npm run build:bun` 成功
- [ ] `./dist-bun/atlas --help` 输出帮助
- [ ] `./dist-bun/atlas list`（或其他只读命令）能正常调用现有 session
- [ ] 体积可接受（< 100 MB）

## 后续路线

- 在 GitHub Release 流程里加 codesign / notarize（macOS）
- 评估是否把 `keytar` 替换为纯 JS + 系统 keyring CLI 调用，去掉 `--external`
- 评估按需 lazy-import `playwright`，让 `auth login` 在缺失时给出清晰提示
