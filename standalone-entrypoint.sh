#!/bin/bash
set -e

DATA_DIR="/app/resources/data"
DATA_FULL_DIR="/app/resources/data_full"
SIMC_CACHE_DIR="/app/resources/simc"   # persistent volume
SIMC_LINK="/usr/local/bin/simc"

# SimC release configuration
SIMC_REPO="sortbek/simc-builds"
SIMC_BRANCH="${SIMC_BRANCH:-weekly}"       # "weekly" or "nightly" — which branch is active
SIMC_VERSION="${SIMC_VERSION:-}"            # optional: pin to specific tag, e.g. "weekly-2026-04-12"

mkdir -p "$DATA_FULL_DIR" "$SIMC_CACHE_DIR"

# ---------------------------------------------------------------------------
# Per-branch directory structure:
#   /app/resources/simc/weekly/simc      (.version contains tag)
#   /app/resources/simc/nightly/simc     (.version contains tag)
#   /app/resources/simc/.active          (contains "weekly" or "nightly")
# ---------------------------------------------------------------------------

# Resolve which branch a tag belongs to
branch_for_tag() {
    case "$1" in
        weekly-*)  echo "weekly"  ;;
        nightly-*) echo "nightly" ;;
        *)         echo "unknown" ;;
    esac
}

simc_bin_for_branch() {
    echo "$SIMC_CACHE_DIR/$1/simc"
}

simc_version_for_branch() {
    cat "$SIMC_CACHE_DIR/$1/.version" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# fetch_simc_branch: download simc for a given branch (or pinned tag)
#   Usage: fetch_simc_branch <branch> [pinned_tag]
# ---------------------------------------------------------------------------
fetch_simc_branch() {
    local BRANCH="$1"
    local PINNED_TAG="$2"
    local BRANCH_DIR="$SIMC_CACHE_DIR/$BRANCH"
    local BIN="$BRANCH_DIR/simc"
    local VERSION_FILE="$BRANCH_DIR/.version"

    mkdir -p "$BRANCH_DIR"

    # Determine target architecture
    local ASSET="simc-linux-x64.tar.gz"

    local TAG RELEASE_JSON

    if [ -n "$PINNED_TAG" ]; then
        TAG="$PINNED_TAG"
        echo "    Using pinned version: $TAG"
        RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/releases/tags/$TAG" 2>/dev/null) || {
            echo "ERROR: Release tag '$TAG' not found." >&2
            return 1
        }
    else
        echo "    Looking for latest $BRANCH release..."
        local RELEASES_JSON
        RELEASES_JSON=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/releases" 2>/dev/null) || {
            echo "ERROR: Could not fetch releases from GitHub." >&2
            return 1
        }
        RELEASE_JSON=$(echo "$RELEASES_JSON" | jq -r --arg prefix "$BRANCH-" \
            '[.[] | select(.tag_name | startswith($prefix))][0] // empty')
        if [ -z "$RELEASE_JSON" ] || [ "$RELEASE_JSON" = "null" ]; then
            echo "ERROR: No $BRANCH release found." >&2
            return 1
        fi
        TAG=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
        echo "    Found: $TAG"
    fi

    # Check if we already have this version cached
    local CACHED_VERSION
    CACHED_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || true)
    if [ "$CACHED_VERSION" = "$TAG" ] && [ -x "$BIN" ]; then
        echo "==> simc $TAG ($BRANCH) is already installed. Skipping."
        return 0
    fi

    # Get the download URL
    local DOWNLOAD_URL
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r --arg asset "$ASSET" \
        '.assets[] | select(.name == $asset) | .browser_download_url')
    if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
        echo "ERROR: Asset '$ASSET' not found in release $TAG." >&2
        return 1
    fi

    echo "==> Downloading $ASSET from $TAG..."
    local TMPFILE
    TMPFILE=$(mktemp)
    curl -fsSL -o "$TMPFILE" "$DOWNLOAD_URL"

    echo "==> Extracting simc binary to $BRANCH/..."
    tar -xzf "$TMPFILE" -C "$BRANCH_DIR"
    rm -f "$TMPFILE"
    chmod +x "$BIN"
    echo "$TAG" > "$VERSION_FILE"
    echo "==> simc $TAG ($BRANCH) installed successfully."
}

# ---------------------------------------------------------------------------
# Startup: fetch the active branch, and the other branch if it exists
# ---------------------------------------------------------------------------
echo "==> Checking sortbek/simc-builds for SimC binaries..."

# Fetch the active branch (required)
if [ -n "$SIMC_VERSION" ]; then
    ACTIVE_BRANCH=$(branch_for_tag "$SIMC_VERSION")
    if ! fetch_simc_branch "$ACTIVE_BRANCH" "$SIMC_VERSION"; then
        BIN=$(simc_bin_for_branch "$ACTIVE_BRANCH")
        if [ -x "$BIN" ]; then
            echo "WARNING: Fetch failed, using cached $ACTIVE_BRANCH binary." >&2
        else
            echo "FATAL: Fetch failed and no cached binary available." >&2
            exit 1
        fi
    fi
else
    ACTIVE_BRANCH="$SIMC_BRANCH"
    if ! fetch_simc_branch "$ACTIVE_BRANCH"; then
        BIN=$(simc_bin_for_branch "$ACTIVE_BRANCH")
        if [ -x "$BIN" ]; then
            echo "WARNING: Fetch failed, using cached $ACTIVE_BRANCH binary." >&2
        else
            echo "FATAL: Fetch failed and no cached binary available." >&2
            exit 1
        fi
    fi
fi

# Also update the other branch if it was previously installed (non-blocking)
for OTHER_BRANCH in weekly nightly; do
    if [ "$OTHER_BRANCH" != "$ACTIVE_BRANCH" ] && [ -d "$SIMC_CACHE_DIR/$OTHER_BRANCH" ]; then
        echo "==> Also updating $OTHER_BRANCH branch..."
        fetch_simc_branch "$OTHER_BRANCH" || echo "    (non-critical, skipped)"
    fi
done

# Write active branch marker and symlink
echo "$ACTIVE_BRANCH" > "$SIMC_CACHE_DIR/.active"
ACTIVE_BIN=$(simc_bin_for_branch "$ACTIVE_BRANCH")
ln -sf "$ACTIVE_BIN" "$SIMC_LINK"
echo "==> Active SimC: $(simc_version_for_branch "$ACTIVE_BRANCH") ($ACTIVE_BRANCH)"

# ---------------------------------------------------------------------------
# Fetch and compact Raidbots game data
# ---------------------------------------------------------------------------
echo "==> Fetching latest Raidbots game data..."
curl -fsSL -o "$DATA_FULL_DIR/metadata.json" https://www.raidbots.com/static/data/live/metadata.json
for f in $(jq -r '.files[]' "$DATA_FULL_DIR/metadata.json"); do
    echo "    Downloading $f..."
    HTTP_CODE=$(curl -sSL -w "%{http_code}" -o "$DATA_FULL_DIR/$f" \
        "https://www.raidbots.com/static/data/live/$f")
    if [ "$HTTP_CODE" != "200" ]; then
        echo "    WARNING: $f returned HTTP $HTTP_CODE, skipping."
        rm -f "$DATA_FULL_DIR/$f"
    fi
done

cp /app/default_season_config.json "$DATA_FULL_DIR/season-config.json"

echo "==> Fetching Blizzard data..."
curl -sL -o "$DATA_FULL_DIR/blizzard-season.json" https://simhammer.com/api/blizzard/season || true
curl -sL -o "$DATA_FULL_DIR/blizzard-instances.json" https://simhammer.com/api/blizzard/instances || true

echo "==> Compacting game data..."
node /app/compact-data.js "$DATA_FULL_DIR" "$DATA_DIR"

export SIMC_DIR="$SIMC_CACHE_DIR"
export DATA_DIR="$DATA_DIR"

# ---------------------------------------------------------------------------
# Background update checker
# ---------------------------------------------------------------------------
SIMC_CHECK_INTERVAL="${SIMC_CHECK_INTERVAL:-3600}"

simc_update_loop() {
    while true; do
        sleep "$SIMC_CHECK_INTERVAL"
        echo "[simc-updater] Checking for updates..."

        # Update all installed branches
        for BRANCH_DIR in "$SIMC_CACHE_DIR"/*/; do
            BRANCH=$(basename "$BRANCH_DIR")
            case "$BRANCH" in weekly|nightly) ;; *) continue ;; esac
            fetch_simc_branch "$BRANCH" || echo "[simc-updater] $BRANCH check failed."
        done

        # Re-symlink the active branch (may have been updated)
        CURRENT_ACTIVE=$(cat "$SIMC_CACHE_DIR/.active" 2>/dev/null || echo "$SIMC_BRANCH")
        ln -sf "$(simc_bin_for_branch "$CURRENT_ACTIVE")" "$SIMC_LINK"
    done
}

simc_update_loop &

echo "==> Starting SimHammer Server..."
exec "$@"
