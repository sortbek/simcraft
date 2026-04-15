#!/bin/bash
set -e

SIMC_DIR="${SIMC_DIR:-/app/resources/simc}"
SIMC_REPO="sortbek/simc-builds"
SIMC_CHECK_INTERVAL="${SIMC_CHECK_INTERVAL:-3600}"
SIMC_ENABLED_BRANCHES_RAW="${SIMC_ENABLED_BRANCHES:-weekly}"

detect_simc_asset() {
    local arch="${SIMC_ARCH:-${TARGETARCH:-}}"

    if [ -z "$arch" ] && command -v dpkg >/dev/null 2>&1; then
        arch="$(dpkg --print-architecture)"
    fi
    if [ -z "$arch" ]; then
        arch="$(uname -m)"
    fi

    case "$arch" in
        amd64|x86_64)
            echo "simc-linux-x64.tar.gz"
            ;;
        arm64|aarch64)
            echo "simc-linux-arm64.tar.gz"
            ;;
        *)
            echo "[simc-updater] ERROR: Unsupported container architecture '$arch' for SimC." >&2
            return 1
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Parse enabled branches from comma-separated env var
# ---------------------------------------------------------------------------
parse_branches() {
    local RAW="${SIMC_ENABLED_BRANCHES_RAW//[[:space:]]/}"
    [ -n "$RAW" ] || RAW="weekly"
    IFS=',' read -r -a ENABLED_BRANCHES <<< "$RAW"
}

# ---------------------------------------------------------------------------
# Fetch the latest SimC build for a branch if newer than cached
# ---------------------------------------------------------------------------
fetch_branch() {
    local BRANCH="$1"
    local BRANCH_DIR="$SIMC_DIR/$BRANCH"
    local BIN="$BRANCH_DIR/simc"
    local VERSION_FILE="$BRANCH_DIR/.version"
    local SIMC_ASSET

    mkdir -p "$BRANCH_DIR"
    SIMC_ASSET="$(detect_simc_asset)" || return 1

    local TAG
    TAG=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/tags?per_page=100" \
        | jq -r --arg prefix "$BRANCH-" '[.[] | select(.name | startswith($prefix))][0].name') || {
        echo "[simc-updater] ERROR: Could not fetch tags from GitHub." >&2
        return 1
    }
    if [ -z "$TAG" ] || [ "$TAG" = "null" ]; then
        echo "[simc-updater] ERROR: No tag found for branch $BRANCH." >&2
        return 1
    fi

    # Already cached?
    local CACHED
    CACHED=$(cat "$VERSION_FILE" 2>/dev/null || true)
    if [ "$CACHED" = "$TAG" ] && [ -x "$BIN" ]; then
        echo "[simc-updater] $BRANCH is up to date ($TAG)."
        return 0
    fi

    local URL
    URL=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/releases/tags/$TAG" \
        | jq -r --arg asset "$SIMC_ASSET" '.assets[] | select(.name == $asset) | .browser_download_url')
    if [ -z "$URL" ] || [ "$URL" = "null" ]; then
        echo "[simc-updater] ERROR: Asset '$SIMC_ASSET' not found in $TAG." >&2
        return 1
    fi

    echo "[simc-updater] Downloading $TAG ($BRANCH)..."
    local TMP
    TMP=$(mktemp)
    curl -fsSL -o "$TMP" "$URL"
    tar -xzf "$TMP" -C "$BRANCH_DIR"
    rm -f "$TMP"
    chmod +x "$BIN"
    echo "$TAG" > "$VERSION_FILE"
    echo "[simc-updater] $BRANCH updated to $TAG."
}

# ---------------------------------------------------------------------------
# Background update loop
# ---------------------------------------------------------------------------
update_loop() {
    while true; do
        sleep "$SIMC_CHECK_INTERVAL"
        echo "[simc-updater] Checking for updates..."
        for BRANCH in "${ENABLED_BRANCHES[@]}"; do
            fetch_branch "$BRANCH" || echo "[simc-updater] $BRANCH check failed."
        done
    done
}

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
parse_branches

# Skip updater if a source build is active
ACTIVE_BRANCH=$(cat "$SIMC_DIR/.active" 2>/dev/null || true)
if echo "$ACTIVE_BRANCH" | grep -q "^source-"; then
    echo "[simc-updater] Source build detected ($ACTIVE_BRANCH) — skipping remote updates."
else
    SIMC_ASSET_NAME="$(detect_simc_asset)"
    echo "[simc-updater] Enabled branches: ${ENABLED_BRANCHES[*]}, check interval: ${SIMC_CHECK_INTERVAL}s"
    echo "[simc-updater] Using SimC asset: ${SIMC_ASSET_NAME}"

    # Initial check
    for BRANCH in "${ENABLED_BRANCHES[@]}"; do
        fetch_branch "$BRANCH" || true
    done

    # Start background loop
    update_loop &
fi

exec "$@"
