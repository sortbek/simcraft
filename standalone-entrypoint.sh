#!/bin/bash
set -e

DATA_DIR="/app/resources/data"
SIMC_DIR="/app/resources/simc_repo"
SIMC_BIN="/usr/local/bin/simc"

mkdir -p "$DATA_DIR"
mkdir -p "$SIMC_DIR"

echo "Fetching latest Raidbots game data..."
curl -sL -o "$DATA_DIR/metadata.json" https://www.raidbots.com/static/data/live/metadata.json
for f in $(jq -r '.files[]' "$DATA_DIR/metadata.json"); do
    echo "Downloading $f..."
    curl -sL -o "$DATA_DIR/$f" "https://www.raidbots.com/static/data/live/$f"
done

# Make sure season-config is present
cp /app/default_season_config.json "$DATA_DIR/season-config.json"

echo "Checking for SimulationCraft updates..."
BUILD_NEEDED=false

if [ ! -d "$SIMC_DIR/.git" ]; then
    echo "Cloning SimulationCraft (shallow)..."
    git clone --depth 1 https://github.com/simulationcraft/simc.git "$SIMC_DIR"
    BUILD_NEEDED=true
else
    cd "$SIMC_DIR"
    echo "Fetching latest changes (shallow)..."
    git fetch --depth 1 origin master
    
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse FETCH_HEAD)
    
    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "Updates found. Updating to latest commit..."
        git reset --hard FETCH_HEAD
        BUILD_NEEDED=true
    elif [ ! -f "$SIMC_BIN" ]; then
        BUILD_NEEDED=true
    else
        echo "SimulationCraft is up to date."
    fi
fi

if [ "$BUILD_NEEDED" = "true" ]; then
    echo "Compiling SimulationCraft (this may take a few minutes depending on CPU)..."
    cd "$SIMC_DIR/engine"
    make -j$(nproc) OPENSSL=0
    cp simc "$SIMC_BIN"
    echo "SimulationCraft compiled successfully."
fi

export SIMC_PATH="$SIMC_BIN"

echo "Starting SimHammer Server..."
exec "$@"
