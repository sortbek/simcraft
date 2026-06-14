#!/usr/bin/env python3
"""Composite MDT dungeon map tiles into one image per dungeon + sublevel.

MDT ships each custom dungeon map as a 15-column x 10-row grid of 128px PNG
tiles named `{sublevel}_{n}.png` (n = 1..150, row-major: n = (row-1)*15 + col).
This stitches them into a single PNG the frontend can pan/zoom over.

Output: <out-dir>/{dungeonIndex}_{sublevel}.png

Dungeons whose maps use Blizzard WorldMap textures (no custom PNG tiles, e.g.
the MoP dungeons) are skipped — there is nothing to composite.

Requires Pillow. Usage:
    python composite_mdt_maps.py <MDT-repo-dir> <out-dir> [--only IDX[,IDX...]]
"""

import re
import sys
from pathlib import Path

from PIL import Image

COLS = 15
ROWS = 10
TILES = COLS * ROWS


def texture_folder(text: str):
    """Extract the custom texture folder name from a `customTextures = '...'`
    assignment, or None if the dungeon has none. The value is a Lua string
    concatenation (`'...AddOns\\'..addonName..'\\Expansion\\Textures\\Folder'`),
    so match the `Textures\\<Folder>` tail directly. Folder casing differs from
    the Lua filename (e.g. SeatoftheTriumvirate.lua -> SeatOfTheTriumvirate)."""
    m = re.search(r"customTextures[^\n]*?Textures\\\\([A-Za-z0-9_]+)", text)
    return m.group(1) if m else None


def sublevels(text: str):
    """Sublevel indices declared in MDT.dungeonSubLevels, defaulting to [1]."""
    m = re.search(r"MDT\.dungeonSubLevels\[dungeonIndex\]\s*=\s*\{(.*?)\n\}", text, re.S)
    if not m:
        return [1]
    idxs = [int(x) for x in re.findall(r"\[(\d+)\]", m.group(1))]
    return idxs or [1]


def composite_sublevel(tex_dir: Path, sublevel: int, out_path: Path) -> bool:
    """Stitch one sublevel's tiles. Returns True if an image was written."""
    tiles = {}
    for n in range(1, TILES + 1):
        p = tex_dir / f"{sublevel}_{n}.png"
        if p.exists():
            tiles[n] = p
    if not tiles:
        return False

    # Tile dimensions from the first available tile (all are uniform, 128px).
    with Image.open(next(iter(tiles.values()))) as first:
        tw, th = first.size

    canvas = Image.new("RGBA", (COLS * tw, ROWS * th), (0, 0, 0, 0))
    for n, p in tiles.items():
        col = (n - 1) % COLS
        row = (n - 1) // COLS
        with Image.open(p) as tile:
            canvas.paste(tile.convert("RGBA"), (col * tw, row * th))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG")
    return True


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    repo = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    only = None
    if "--only" in sys.argv:
        only = {int(x) for x in sys.argv[sys.argv.index("--only") + 1].split(",")}

    written = 0
    for lua_file in sorted(repo.rglob("*.lua")):
        text = lua_file.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"local dungeonIndex\s*=\s*(\d+)", text)
        if not m or "MDT.dungeonEnemies[dungeonIndex]" not in text:
            continue
        idx = int(m.group(1))
        if only is not None and idx not in only:
            continue
        folder = texture_folder(text)
        if not folder:
            continue  # Blizzard-texture dungeon, no custom tiles
        tex_dir = lua_file.parent / "Textures" / folder
        if not tex_dir.is_dir():
            print(f"  ! {lua_file.name} (idx {idx}): texture dir {tex_dir} missing", file=sys.stderr)
            continue
        for sub in sublevels(text):
            out_path = out_dir / f"{idx}_{sub}.png"
            if composite_sublevel(tex_dir, sub, out_path):
                written += 1
                print(f"  composited dungeon {idx} sublevel {sub} -> {out_path.name}")

    print(f"wrote {written} map image(s) to {out_dir}")


if __name__ == "__main__":
    main()
