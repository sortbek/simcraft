#!/bin/bash
set -e

DATA_DIR="/app/resources/data"
DATA_FULL_DIR="/app/resources/data_full"
SIMC_CACHE_DIR="/app/resources/simc"   # persistent volume
SIMC_LINK="/usr/local/bin/simc"

# SimC release configuration
SIMC_REPO="sortbek/simc-builds"
SIMC_ENABLED_BRANCHES_RAW="${SIMC_ENABLED_BRANCHES:-weekly}"   # comma-separated, e.g. "weekly,nightly"

mkdir -p "$DATA_FULL_DIR" "$SIMC_CACHE_DIR"

# ---------------------------------------------------------------------------
# Per-branch directory structure:
#   /app/resources/simc/weekly/simc      (.version contains tag)
#   /app/resources/simc/nightly/simc     (.version contains tag)
#   /app/resources/simc/.active          (contains "weekly" or "nightly")
# ---------------------------------------------------------------------------

simc_bin_for_branch() {
    echo "$SIMC_CACHE_DIR/$1/simc"
}

simc_version_for_branch() {
    cat "$SIMC_CACHE_DIR/$1/.version" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# fetch_simc_branch: download the latest simc build for a branch
#   Usage: fetch_simc_branch <branch>
# ---------------------------------------------------------------------------
fetch_simc_branch() {
    local BRANCH="$1"
    local BRANCH_DIR="$SIMC_CACHE_DIR/$BRANCH"
    local BIN="$BRANCH_DIR/simc"
    local VERSION_FILE="$BRANCH_DIR/.version"

    mkdir -p "$BRANCH_DIR"

    # Determine target architecture
    local ASSET="simc-linux-x64.tar.gz"

    local TAG
    echo "    Looking for latest $BRANCH release..."
    TAG=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/tags?per_page=100" 2>/dev/null \
        | jq -r --arg prefix "$BRANCH-" '[.[] | select(.name | startswith($prefix))][0].name') || {
        echo "ERROR: Could not fetch tags from GitHub." >&2
        return 1
    }
    if [ -z "$TAG" ] || [ "$TAG" = "null" ]; then
        echo "ERROR: No $BRANCH release found." >&2
        return 1
    fi
    echo "    Found: $TAG"

    # Check if we already have this version cached
    local CACHED_VERSION
    CACHED_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || true)
    if [ "$CACHED_VERSION" = "$TAG" ] && [ -x "$BIN" ]; then
        echo "==> simc $TAG ($BRANCH) is already installed. Skipping."
        return 0
    fi

    # Get the download URL
    local DOWNLOAD_URL RELEASE_JSON
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$SIMC_REPO/releases/tags/$TAG" 2>/dev/null) || {
        echo "ERROR: Could not fetch release for tag $TAG." >&2
        return 1
    }
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

valid_branch() {
    case "$1" in
        weekly|nightly) return 0 ;;
        *) return 1 ;;
    esac
}

parse_enabled_branches() {
    local RAW="${SIMC_ENABLED_BRANCHES_RAW//[[:space:]]/}"
    local BRANCH EXISTS

    if [ -z "$RAW" ]; then
        RAW="weekly"
    fi

    IFS=',' read -r -a REQUESTED_BRANCHES <<< "$RAW"
    ENABLED_BRANCHES=()

    for BRANCH in "${REQUESTED_BRANCHES[@]}"; do
        [ -z "$BRANCH" ] && continue
        if ! valid_branch "$BRANCH"; then
            echo "FATAL: Unknown SimC branch '$BRANCH'. Valid values are 'weekly' and 'nightly'." >&2
            exit 1
        fi

        EXISTS=0
        for EXISTING in "${ENABLED_BRANCHES[@]}"; do
            if [ "$EXISTING" = "$BRANCH" ]; then
                EXISTS=1
                break
            fi
        done

        if [ "$EXISTS" -eq 0 ]; then
            ENABLED_BRANCHES+=("$BRANCH")
        fi
    done

    if [ "${#ENABLED_BRANCHES[@]}" -eq 0 ]; then
        ENABLED_BRANCHES=("weekly")
    fi
}

is_enabled_branch() {
    local TARGET="$1"
    for BRANCH in "${ENABLED_BRANCHES[@]}"; do
        if [ "$BRANCH" = "$TARGET" ]; then
            return 0
        fi
    done
    return 1
}

choose_active_branch() {
    if is_enabled_branch "weekly"; then
        ACTIVE_BRANCH="weekly"
    else
        ACTIVE_BRANCH="${ENABLED_BRANCHES[0]}"
    fi
}

prune_disabled_branches() {
    for KNOWN_BRANCH in weekly nightly; do
        if ! is_enabled_branch "$KNOWN_BRANCH" && [ -d "$SIMC_CACHE_DIR/$KNOWN_BRANCH" ]; then
            echo "==> Removing disabled $KNOWN_BRANCH branch from cache..."
            rm -rf "$SIMC_CACHE_DIR/$KNOWN_BRANCH"
        fi
    done
}

ensure_simc_branch() {
    local BRANCH="$1"
    if ! fetch_simc_branch "$BRANCH"; then
        local BIN
        BIN=$(simc_bin_for_branch "$BRANCH")
        if [ -x "$BIN" ]; then
            echo "WARNING: Fetch failed, using cached $BRANCH binary." >&2
        else
            echo "FATAL: Fetch failed and no cached $BRANCH binary available." >&2
            exit 1
        fi
    fi
}

# ---------------------------------------------------------------------------
# Startup: fetch all enabled branches and expose only those branches
# ---------------------------------------------------------------------------
echo "==> Checking sortbek/simc-builds for SimC binaries..."
parse_enabled_branches
choose_active_branch
prune_disabled_branches
echo "==> Enabled SimC branches: ${ENABLED_BRANCHES[*]}"

# Fetch the default branch first, then the rest of the enabled branches
ensure_simc_branch "$ACTIVE_BRANCH"
for BRANCH in "${ENABLED_BRANCHES[@]}"; do
    if [ "$BRANCH" != "$ACTIVE_BRANCH" ]; then
        echo "==> Also fetching $BRANCH branch..."
        ensure_simc_branch "$BRANCH"
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

        for BRANCH in "${ENABLED_BRANCHES[@]}"; do
            fetch_simc_branch "$BRANCH" || echo "[simc-updater] $BRANCH check failed."
        done

        CURRENT_ACTIVE=$(cat "$SIMC_CACHE_DIR/.active" 2>/dev/null || echo "$ACTIVE_BRANCH")
        if ! is_enabled_branch "$CURRENT_ACTIVE"; then
            CURRENT_ACTIVE="$ACTIVE_BRANCH"
        fi
        ln -sf "$(simc_bin_for_branch "$CURRENT_ACTIVE")" "$SIMC_LINK"
    done
}

simc_update_loop &

echo "==> Starting SimHammer Server..."
exec "$@"
