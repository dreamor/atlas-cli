#!/usr/bin/env bash
# publish-release.sh — 构建 Atlas CLI 二进制并发布到 GitHub release-only 仓库。
#
# 流程：
#   1. 在本地构建所有平台二进制
#   2. 如果安装脚本有变更，同步到 dist/main
#   3. 打 tag 并创建 release，上传二进制（release note 只写版本号）
#
# 不会将任何源码推送到 GitHub。
#
# 用法:
#   ./scripts/publish-release.sh v0.2.3
#
# 前置条件:
#   - bun (用于编译)
#   - gh CLI (已通过 gh auth login 认证)
#   - remote "dist" 指向 github.com/dreamor/atlas-cli
#   - 在当前本地 main 分支上执行

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法: $0 <version>"
  echo "示例: $0 v0.2.3"
  exit 1
fi

VERSION="$1"
REPO="dreamor/atlas-cli"
REMOTE="dist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_ROOT/dist-bun"

# ── 安全检查 ──────────────────────────────────────────────

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "错误：请先在本地 main 分支上执行此脚本"
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "错误：remote '$REMOTE' 不存在"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "错误：需要安装 gh CLI (https://cli.github.com)"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "错误：gh 未登录，请执行 gh auth login"
  exit 1
fi

echo "═══════════════════════════════════════════════"
echo "  发布 Atlas CLI $VERSION"
echo "═══════════════════════════════════════════════"

# ── 1. 构建所有平台的二进制 ──────────────────────────────

echo ""
echo "▶ 构建二进制..."

npm run build:bun:mac-arm64
npm run build:bun:mac-x64
npm run build:bun:linux-arm64
npm run build:bun:linux-x64
npm run build:bun:win-x64

echo "  构建产物:"
ls -lh "$OUT_DIR"/

# ── 2. 同步安装脚本到 dist/main ──────────────────────────

echo ""
echo "▶ 同步安装脚本到 $REMOTE/main..."

TEMP_WORKTREE="$(mktemp -d)"
trap 'rm -rf "$TEMP_WORKTREE"' EXIT

# 从远程获取最新的 main
git fetch "$REMOTE" main

# 创建临时工作目录操作
git worktree add "$TEMP_WORKTREE" "FETCH_HEAD" 2>/dev/null || {
  # FETCH_HEAD 可能不可用，直接 checkout 远程的干净版本
  git clone --depth 1 "$(git remote get-url "$REMOTE")" "$TEMP_WORKTREE" --branch main
}

# 复制本地的安装脚本到临时工作树
cp "$PROJECT_ROOT/scripts/install.sh" "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.sh" "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/install.ps1" "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.ps1" "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/install.bat" "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.bat" "$TEMP_WORKTREE/scripts/"

# 检查是否有变更
pushd "$TEMP_WORKTREE" &>/dev/null
if git status --porcelain | grep -q .; then
  git add -A
  git commit -m "chore: update install scripts for $VERSION"
  git push "$REMOTE" HEAD:main
  echo "  安装脚本已推送"
else
  echo "  安装脚本无变更，跳过推送"
fi
popd &>/dev/null

git worktree remove "$TEMP_WORKTREE" 2>/dev/null || true
rm -rf "$TEMP_WORKTREE"

# ── 3. 打 tag 并创建 release ────────────────────────────

echo ""
echo "▶ 创建 release $VERSION..."

# 检查是否已存在同名 tag（本地和远程）
if git tag | grep -q "^${VERSION}$"; then
  echo "  本地 tag $VERSION 已存在，删除重建"
  git tag -d "$VERSION"
fi

# 这个 tag 指向本地 main 的最新提交（只是用来追踪版本，不推源码）
git tag "$VERSION"

# 推送 tag 到 dist remote
git push "$REMOTE" "$VERSION" || true

# 创建 release（如果已存在会失败，忽略）
gh release create "$VERSION" \
  "$OUT_DIR/atlas-darwin-arm64" \
  "$OUT_DIR/atlas-darwin-x64" \
  "$OUT_DIR/atlas-linux-arm64" \
  "$OUT_DIR/atlas-linux-x64" \
  "$OUT_DIR/atlas-windows-x64.exe" \
  -R "$REPO" \
  --title "$VERSION" \
  --notes "$VERSION" 2>&1 || {
    # 如果 release 已存在，尝试更新
    echo "  release 可能已存在，尝试更新..."
    gh release upload "$VERSION" \
      "$OUT_DIR/atlas-darwin-arm64" \
      "$OUT_DIR/atlas-darwin-x64" \
      "$OUT_DIR/atlas-linux-arm64" \
      "$OUT_DIR/atlas-linux-x64" \
      "$OUT_DIR/atlas-windows-x64.exe" \
      -R "$REPO" --clobber 2>&1 || true
  }

# ── 完成 ──────────────────────────────────────────────────

echo ""
echo "✅ 发布完成！"
echo "  https://github.com/$REPO/releases/tag/$VERSION"
echo ""
echo "注：仅安装脚本和二进制包已推送到 GitHub，源码安全保留在本地。"