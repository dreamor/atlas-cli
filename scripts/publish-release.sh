#!/usr/bin/env bash
# publish-release.sh — 构建 Atlas CLI 二进制并发布到 GitHub release-only 仓库。
#
# 流程：
#   1. 在本地构建所有平台二进制
#   2. 如果安装脚本有变更，同步到 dist/main
#   3. 打 tag → 创建 release（不含文件）→ 逐个上传二进制
#
# 不会将任何源码推送到 GitHub。
#
# 用法:
#   ./scripts/publish-release.sh v0.4.0
#
# 前置条件:
#   - bun (用于编译)
#   - gh CLI (已通过 gh auth login 认证)
#   - remote "dist" 指向 github.com/dreamor/atlas-cli
#   - 在当前本地 main 分支上执行

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法: $0 <version>"
  echo "示例: $0 v0.4.0"
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

BINARIES=(
  "$OUT_DIR/atlas-darwin-arm64"
  "$OUT_DIR/atlas-darwin-x64"
  "$OUT_DIR/atlas-linux-arm64"
  "$OUT_DIR/atlas-linux-x64"
  "$OUT_DIR/atlas-windows-x64.exe"
)

# ── 2.5 生成 SHA256SUMS ──────────────────────────────────

echo ""
echo "▶ 生成 SHA256 校验和..."

SHA256SUMS_FILE="$OUT_DIR/SHA256SUMS"
# 清空旧文件
: > "$SHA256SUMS_FILE"

for bin in "${BINARIES[@]}"; do
  name="$(basename "$bin")"
  if command -v sha256sum &>/dev/null; then
    (cd "$OUT_DIR" && sha256sum "$name") >> "$SHA256SUMS_FILE"
  elif command -v shasum &>/dev/null; then
    (cd "$OUT_DIR" && shasum -a 256 "$name") >> "$SHA256SUMS_FILE"
  else
    echo "错误：找不到 sha256sum 或 shasum" >&2
    exit 1
  fi
done

echo "  SHA256SUMS 已生成 ($(wc -l < "$SHA256SUMS_FILE") entries)"

# ── 2. 同步安装脚本到 dist/main ──────────────────────────

echo ""
echo "▶ 同步安装脚本到 $REMOTE/main..."

TEMP_WORKTREE="$(mktemp -d)"
trap 'rm -rf "$TEMP_WORKTREE"' EXIT

git fetch "$REMOTE" main

git worktree add "$TEMP_WORKTREE" "FETCH_HEAD" 2>/dev/null || {
  git clone --depth 1 "$(git remote get-url "$REMOTE")" "$TEMP_WORKTREE" --branch main
}

cp "$PROJECT_ROOT/scripts/install.sh"     "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.sh"   "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/install.ps1"    "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.ps1"  "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/install.bat"    "$TEMP_WORKTREE/scripts/"
cp "$PROJECT_ROOT/scripts/bootstrap.bat"  "$TEMP_WORKTREE/scripts/"

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

# ── 3. 打 tag ────────────────────────────────────────────

echo ""
echo "▶ 创建 tag $VERSION..."

if git tag | grep -q "^${VERSION}$"; then
  echo "  本地 tag $VERSION 已存在，删除重建"
  git tag -d "$VERSION"
fi

git tag "$VERSION"
git push "$REMOTE" "$VERSION" || true

# ── 4. 创建 release（不含文件） ─────────────────────────

echo ""
echo "▶ 创建 release..."

# 如果之前跑失败留下了同名 release/draft，先清理
gh release delete "$VERSION" -R "$REPO" --yes 2>/dev/null || true

gh release create "$VERSION" \
  -R "$REPO" \
  --title "$VERSION" \
  --notes "$VERSION"

echo "  release 已创建"

# ── 5. 上传二进制 + SHA256SUMS ────────────────────────

echo ""
echo "▶ 上传二进制 + SHA256SUMS..."

# 上传 SHA256SUMS（先上传，确保签名先到）
echo -n "  上传 SHA256SUMS ... "
gh release upload "$VERSION" "$SHA256SUMS_FILE" \
  -R "$REPO" --clobber 2>&1 | head -1 || true
echo "done"

for bin in "${BINARIES[@]}"; do
  name="$(basename "$bin")"
  echo -n "  上传 $name ... "
  gh release upload "$VERSION" "$bin" \
    -R "$REPO" --clobber 2>&1 | head -1 || true
  echo "done"
done

# ── 完成 ──────────────────────────────────────────────────

echo ""
echo "✅ 发布完成！"
echo "  https://github.com/$REPO/releases/tag/$VERSION"
echo ""
echo "注：仅安装脚本和二进制包已推送到 GitHub，源码安全保留在本地。"