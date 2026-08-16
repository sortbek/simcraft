#!/bin/bash
# Downloads all game data files listed in Raidbots metadata.json
# Usage: ./fetch-data.sh [output_dir]

set -e

BASE_URL="https://www.raidbots.com/static/data/live"
OUT_DIR="${1:-.}"

mkdir -p "$OUT_DIR"

echo "Fetching metadata..."
curl -sL "$BASE_URL/metadata.json" -o "$OUT_DIR/metadata.json"

echo "Downloading data files..."
for file in $(sed -n 's/.*"\([^"]*\.\(json\|txt\|lua\)\)".*/\1/p' "$OUT_DIR/metadata.json"); do
    echo "  $file"
    curl -sL "$BASE_URL/$file" -o "$OUT_DIR/$file"
done

# Copy season-config.json (manually maintained, not on Raidbots)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEASON_CONFIG="$SCRIPT_DIR/../../core/season-config.json"
if [ -f "$SEASON_CONFIG" ]; then
    cp "$SEASON_CONFIG" "$OUT_DIR/season-config.json"
    echo "Copied season-config.json"
fi

# Refresh the icon FileDataID map. Raidbots only ships icon *names*, and
# Blizzard's CDN serves newer art by FileDataID only, so names added this patch
# would 403. Needs Blizzard API credentials; without them the committed map is
# kept and any new icons fall back to their name.
if [ -n "$BLIZZARD_CLIENT_ID" ] && [ -n "$BLIZZARD_CLIENT_SECRET" ]; then
    echo "Refreshing icon FileDataIDs..."
    # `python` is absent on distros that ship only python3; `set -e` would abort
    # the whole refresh after every file had already downloaded.
    "$(command -v python3 || command -v python)" \
        "$SCRIPT_DIR/../../scripts/fetch_icon_file_ids.py" "$OUT_DIR"
else
    echo "Skipping icon FileDataIDs (set BLIZZARD_CLIENT_ID/SECRET to refresh)."
fi

echo "Done."
