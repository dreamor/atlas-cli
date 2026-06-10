#!/usr/bin/env bash
# Atlas CLI one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.sh | bash
#
# Downloads scripts/bootstrap.sh and runs it. All env overrides for bootstrap.sh
# (ATLAS_HOME, GH_REPO, NODE_VERSION, ATLAS_BOOTSTRAP_YES, ...) work here too.

set -euo pipefail

GH_REPO="${GH_REPO:-dreamor/atlas-cli}"
GH_BRANCH="${GH_BRANCH:-main}"
BOOTSTRAP_URL="${BOOTSTRAP_URL:-https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/scripts/bootstrap.sh}"

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }

tmp="$(mktemp -t atlas-bootstrap.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

log "Fetching $BOOTSTRAP_URL"
if ! curl -fsSL --retry 3 -o "$tmp" "$BOOTSTRAP_URL"; then
  err "Failed to download bootstrap script."
  err "Set BOOTSTRAP_URL or GH_REPO/GH_BRANCH if using a fork or private mirror."
  exit 1
fi

chmod +x "$tmp"
exec bash "$tmp" "$@"
