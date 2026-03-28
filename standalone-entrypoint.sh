#!/bin/bash
set -e

DATA_DIR="/app/resources/data"
DATA_FULL_DIR="/app/resources/data_full"
SIMC_CACHE_DIR="/app/resources/simc"   # persistent volume
SIMC_BIN="$SIMC_CACHE_DIR/simc"
SIMC_DIGEST_FILE="$SIMC_CACHE_DIR/.digest"
SIMC_LINK="/usr/local/bin/simc"

SIMC_IMAGE="simulationcraftorg/simc"
SIMC_TAG="latest"
REGISTRY="https://registry-1.docker.io"
AUTH_URL="https://auth.docker.io"

mkdir -p "$DATA_FULL_DIR" "$SIMC_CACHE_DIR"

# ---------------------------------------------------------------------------
# fetch_simc: pull the simc binary from Docker Hub via the Registry HTTP API.
# Requires only curl, jq, and tar — no Docker daemon.
# Caches the layer digest in $SIMC_DIGEST_FILE; skips download if unchanged.
# ---------------------------------------------------------------------------
fetch_simc() {
    echo "==> Checking Docker Hub for latest simulationcraftorg/simc..."

    # 1. Obtain a pull token for the image
    TOKEN=$(curl -fsSL \
        "$AUTH_URL/token?service=registry.docker.io&scope=repository:${SIMC_IMAGE}:pull" \
        | jq -r '.token')

    if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
        echo "ERROR: Could not obtain Docker Hub auth token." >&2
        return 1
    fi

    # 2. Fetch the manifest (accept both manifest-list and single-platform v2)
    MANIFEST_RAW=$(curl -fsSL \
        -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
        "$REGISTRY/v2/${SIMC_IMAGE}/manifests/${SIMC_TAG}")

    MEDIA_TYPE=$(echo "$MANIFEST_RAW" | jq -r '.mediaType // .schemaVersion // empty')

    # 3. If it's a manifest list / OCI index, resolve to linux/amd64
    if echo "$MEDIA_TYPE" | grep -qE "manifest.list|image.index"; then
        ARCH=$(uname -m)
        case "$ARCH" in
            x86_64)  GOARCH="amd64"  ;;
            aarch64) GOARCH="arm64"  ;;
            *)        GOARCH="amd64"  ;;
        esac

        PLATFORM_DIGEST=$(echo "$MANIFEST_RAW" | jq -r \
            --arg arch "$GOARCH" \
            '.manifests[] | select(.platform.os=="linux" and .platform.architecture==$arch) | .digest' \
            | head -1)

        if [ -z "$PLATFORM_DIGEST" ]; then
            echo "ERROR: Could not find linux/$GOARCH manifest in manifest list." >&2
            return 1
        fi

        MANIFEST_RAW=$(curl -fsSL \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" \
            "$REGISTRY/v2/${SIMC_IMAGE}/manifests/${PLATFORM_DIGEST}")
    fi

    # 4. Read layers (reverse order — simc is in the last COPY layer, which is smallest)
    LAYERS=$(echo "$MANIFEST_RAW" | jq -r '[.layers[].digest] | reverse | .[]')
    if [ -z "$LAYERS" ]; then
        echo "ERROR: No layers found in manifest." >&2
        return 1
    fi

    # 5. Compute a cheap cache key: digest of the first layer that contains simc
    #    We'll discover that layer below and store its digest.

    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' RETURN

    FOUND=false
    for LAYER_DIGEST in $LAYERS; do
        echo "    Checking layer ${LAYER_DIGEST:7:16}..."

        LAYER_FILE="$TMPDIR/layer.tar.gz"
        curl -fsSL \
            -H "Authorization: Bearer $TOKEN" \
            "$REGISTRY/v2/${SIMC_IMAGE}/blobs/${LAYER_DIGEST}" \
            -o "$LAYER_FILE"

        # Does this layer contain the simc binary?
        if tar -tzf "$LAYER_FILE" 2>/dev/null | grep -q "app/SimulationCraft/simc$"; then

            # Check if we already have this exact layer cached
            CACHED_DIGEST=$(cat "$SIMC_DIGEST_FILE" 2>/dev/null || true)
            if [ "$CACHED_DIGEST" = "$LAYER_DIGEST" ] && [ -x "$SIMC_BIN" ]; then
                echo "==> simc is up to date (layer unchanged). Skipping download."
                FOUND=true
                break
            fi

            echo "==> Extracting simc binary from layer..."
            # The path inside the tar is app/SimulationCraft/simc (no leading slash)
            tar -xzf "$LAYER_FILE" -C "$TMPDIR" "app/SimulationCraft/simc" 2>/dev/null
            mv "$TMPDIR/app/SimulationCraft/simc" "$SIMC_BIN"
            chmod +x "$SIMC_BIN"
            echo "$LAYER_DIGEST" > "$SIMC_DIGEST_FILE"
            echo "==> simc updated successfully."
            FOUND=true
            break
        fi
    done

    if [ "$FOUND" = "false" ]; then
        echo "ERROR: simc binary not found in any image layer." >&2
        return 1
    fi
}

# Run the fetch (falls back gracefully if Docker Hub is unreachable and binary is cached)
if ! fetch_simc; then
    if [ -x "$SIMC_BIN" ]; then
        echo "WARNING: Registry fetch failed, using cached simc binary." >&2
    else
        echo "FATAL: Registry fetch failed and no cached simc binary available." >&2
        exit 1
    fi
fi

# Symlink into PATH so the Rust server can invoke it by name as well
ln -sf "$SIMC_BIN" "$SIMC_LINK"

# ---------------------------------------------------------------------------
# Fetch and compact Raidbots game data
# ---------------------------------------------------------------------------
echo "==> Fetching latest Raidbots game data..."
# -f on metadata: we can't proceed without it
curl -fsSL -o "$DATA_FULL_DIR/metadata.json" https://www.raidbots.com/static/data/live/metadata.json
for f in $(jq -r '.files[]' "$DATA_FULL_DIR/metadata.json"); do
    echo "    Downloading $f..."
    # No -f: individual files may 404 (e.g. season-specific data); warn and skip
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

export SIMC_PATH="$SIMC_BIN"
export DATA_DIR="$DATA_DIR"

echo "==> Starting SimHammer Server..."
exec "$@"
