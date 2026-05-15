#!/usr/bin/env bash
# Atlas CLI bootstrap — idempotent dependency installer.
#
# Installs:
#   1. atlas binary       → $ATLAS_HOME/bin/atlas
#   2. Node.js runtime    → $ATLAS_HOME/runtime/node (only if system node < 20)
#   3. playwright + chromium → $ATLAS_HOME/lib/node_modules/playwright + browser cache
#
# Safe to run repeatedly — every check is cheap and skips work when satisfied.
#
# Env overrides:
#   ATLAS_HOME              install root (default: $HOME/.atlas)
#   ATLAS_RELEASE_TAG       atlas binary release (default: latest)
#   GH_REPO                 owner/repo for binary download (default: dreamor/atlas-cli)
#   NODE_VERSION            vendored node version (default: 20.18.0)
#   NODE_MIRROR             node tarball mirror (default: https://nodejs.org/dist)
#   PLAYWRIGHT_VERSION      pinned playwright version (default: 1.49.0)
#   PLAYWRIGHT_DOWNLOAD_HOST chromium mirror (passed to npm install)
#   ATLAS_BOOTSTRAP_YES     non-interactive: skip the size confirmation prompt
#   ATLAS_SKIP_PLAYWRIGHT   skip playwright/chromium install (read-only commands work without it)

set -euo pipefail

ATLAS_HOME="${ATLAS_HOME:-$HOME/.atlas}"
ATLAS_BIN="$ATLAS_HOME/bin"
ATLAS_RUNTIME="$ATLAS_HOME/runtime"
ATLAS_LIB="$ATLAS_HOME/lib"
NODE_VERSION="${NODE_VERSION:-20.18.0}"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.49.0}"
ATLAS_RELEASE_TAG="${ATLAS_RELEASE_TAG:-latest}"
GH_REPO="${GH_REPO:-dreamor/atlas-cli}"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; }

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) err "Unsupported OS: $(uname -s) (only darwin/linux)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64)        arch=x64 ;;
    *) err "Unsupported arch: $(uname -m)"; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

PLATFORM="$(detect_platform)"

confirm_size() {
  if [[ "${ATLAS_BOOTSTRAP_YES:-}" == "1" ]] || [[ ! -t 0 ]]; then
    return
  fi
  local size_msg=""
  [[ ! -x "$ATLAS_BIN/atlas" ]]                 && size_msg+="  atlas binary  ~60MB\n"
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]]; then
    [[ ! -x "$ATLAS_RUNTIME/node/bin/node" ]]   && size_msg+="  Node.js       ~50MB\n"
  fi
  if [[ "${ATLAS_SKIP_PLAYWRIGHT:-}" != "1" ]] && [[ ! -d "$ATLAS_LIB/node_modules/playwright" ]]; then
    size_msg+="  playwright    ~30MB\n"
    size_msg+="  chromium      ~120MB\n"
  fi
  if [[ -z "$size_msg" ]]; then return; fi
  printf '\n[bootstrap] First-time setup will download:\n%b\n' "$size_msg"
  printf '[bootstrap] Continue? [y/N] '
  read -r answer
  case "$answer" in [yY]*) ;; *) err "Aborted."; exit 1 ;; esac
}

ensure_dirs() {
  mkdir -p "$ATLAS_BIN" "$ATLAS_RUNTIME" "$ATLAS_LIB"
}

ensure_atlas() {
  if [[ -x "$ATLAS_BIN/atlas" ]]; then
    log "atlas binary OK ($ATLAS_BIN/atlas)"
    return
  fi
  local artifact="atlas-${PLATFORM}"
  local url
  if [[ "$ATLAS_RELEASE_TAG" == "latest" ]]; then
    url="https://github.com/${GH_REPO}/releases/latest/download/${artifact}"
  else
    url="https://github.com/${GH_REPO}/releases/download/${ATLAS_RELEASE_TAG}/${artifact}"
  fi
  log "Downloading atlas binary from $url"
  if ! curl -fsSL --retry 3 -o "$ATLAS_BIN/atlas" "$url"; then
    err "Failed to download atlas binary."
    err "Hint: set GH_REPO or ATLAS_RELEASE_TAG, or run \`npm run build:bun\` locally."
    exit 1
  fi
  chmod +x "$ATLAS_BIN/atlas"
  if [[ "$PLATFORM" == darwin-* ]]; then
    xattr -d com.apple.quarantine "$ATLAS_BIN/atlas" 2>/dev/null || true
  fi
  log "atlas binary installed."
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')"
    if [[ "$major" -ge 20 ]]; then
      log "system node v$(node -v) found — using it"
      ATLAS_NODE_BIN="$(dirname "$(command -v node)")"
      return
    fi
    warn "system node $(node -v) is too old (need >=20), installing vendored copy"
  fi
  if [[ -x "$ATLAS_RUNTIME/node/bin/node" ]]; then
    log "vendored node already at $ATLAS_RUNTIME/node"
    ATLAS_NODE_BIN="$ATLAS_RUNTIME/node/bin"
    return
  fi
  local node_arch
  case "$PLATFORM" in
    darwin-arm64) node_arch="darwin-arm64" ;;
    darwin-x64)   node_arch="darwin-x64" ;;
    linux-arm64)  node_arch="linux-arm64" ;;
    linux-x64)    node_arch="linux-x64" ;;
  esac
  local url="${NODE_MIRROR}/v${NODE_VERSION}/node-v${NODE_VERSION}-${node_arch}.tar.gz"
  log "Downloading Node ${NODE_VERSION} from $url"
  curl -fsSL --retry 3 "$url" | tar -xz -C "$ATLAS_RUNTIME"
  mv "$ATLAS_RUNTIME/node-v${NODE_VERSION}-${node_arch}" "$ATLAS_RUNTIME/node"
  ATLAS_NODE_BIN="$ATLAS_RUNTIME/node/bin"
  log "Node installed at $ATLAS_RUNTIME/node"
}

ensure_playwright() {
  if [[ "${ATLAS_SKIP_PLAYWRIGHT:-}" == "1" ]]; then
    warn "Skipping playwright (ATLAS_SKIP_PLAYWRIGHT=1). \`auth login\` and \`daemon\` will not work."
    return
  fi
  local pw_dir="$ATLAS_LIB/node_modules/playwright"
  local npm="$ATLAS_NODE_BIN/npm"
  if [[ ! -d "$pw_dir" ]]; then
    log "Installing playwright@${PLAYWRIGHT_VERSION} into $ATLAS_LIB"
    if [[ ! -f "$ATLAS_LIB/package.json" ]]; then
      (cd "$ATLAS_LIB" && "$npm" init -y >/dev/null)
    fi
    (cd "$ATLAS_LIB" && "$npm" install --silent --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}")
  else
    log "playwright OK ($pw_dir)"
  fi
  local pw_cli="$ATLAS_LIB/node_modules/.bin/playwright"
  if "$pw_cli" install chromium --dry-run 2>&1 | grep -q "is already downloaded"; then
    log "chromium OK"
  else
    log "Downloading chromium browser (~120MB)"
    "$pw_cli" install chromium
  fi
}

print_done() {
  cat >&2 <<EOF

[bootstrap] Done. To use atlas globally, add to your shell rc:
    export PATH="$ATLAS_BIN:\$PATH"
    export ATLAS_HOME="$ATLAS_HOME"

[bootstrap] First-time login (opens browser, requires playwright):
    "$ATLAS_BIN/atlas" auth login

[bootstrap] Quick test:
    "$ATLAS_BIN/atlas" --help
EOF
}

main() {
  log "ATLAS_HOME=$ATLAS_HOME PLATFORM=$PLATFORM"
  ensure_dirs
  confirm_size
  ensure_atlas
  ensure_node
  ensure_playwright
  print_done
}

main "$@"
