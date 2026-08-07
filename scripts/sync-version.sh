#!/bin/bash
# Reads VERSION file and syncs it to all project manifests.
# Usage: bash scripts/sync-version.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"

echo "Syncing version: $VERSION"

# Cargo workspace. Cargo.lock records each workspace member's own version, so it
# goes stale unless refreshed here, which breaks `cargo build --locked` in the
# Docker images. `--workspace` touches only our own packages, never third-party
# dependencies.
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/backend/Cargo.toml"
(cd "$ROOT/backend" && cargo update --workspace --offline)

# npm projects. `npm version` updates package.json and package-lock.json
# together; editing package.json alone left every lockfile stranded at 3.1.0.
for d in "$ROOT/frontend" "$ROOT/desktop" "$ROOT"; do
    [ -f "$d/package.json" ] || continue
    (cd "$d" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
done

echo "Done."
