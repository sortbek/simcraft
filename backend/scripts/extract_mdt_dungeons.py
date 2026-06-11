#!/usr/bin/env python3
"""Extract the static MDT enemy database from the MythicDungeonTools addon.

The MDT export string only carries dungeon index, affix week, keystone level and
the pulls (enemy + clone indices). Enemy NPC ids, base health, forces count and
creature type live in the addon's per-dungeon Lua files
(``MDT.dungeonEnemies[<idx>]``). This script parses those Lua table literals and
emits a compact JSON the backend loads at runtime.

Zero external dependencies: a small recursive-descent parser handles the subset
of Lua used in these data files (tables, strings, numbers, booleans, nil, and
``L["..."]`` localization wrappers).

Usage:
    python extract_mdt_dungeons.py <MDT-repo-dir> <out.json> [--only IDX[,IDX...]]
"""

import json
import re
import sys
from pathlib import Path


class LuaParser:
    """Recursive-descent parser for Lua table-literal data."""

    def __init__(self, text: str):
        self.s = text
        self.i = 0
        self.n = len(text)

    def _skip_ws(self):
        while self.i < self.n:
            c = self.s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif self.s.startswith("--[[", self.i):
                end = self.s.find("]]", self.i + 4)
                self.i = self.n if end < 0 else end + 2
            elif self.s.startswith("--", self.i):
                nl = self.s.find("\n", self.i)
                self.i = self.n if nl < 0 else nl + 1
            else:
                break

    def _parse_string(self) -> str:
        quote = self.s[self.i]
        self.i += 1
        out = []
        while self.i < self.n:
            c = self.s[self.i]
            if c == "\\":
                nxt = self.s[self.i + 1]
                out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nxt, nxt))
                self.i += 2
            elif c == quote:
                self.i += 1
                return "".join(out)
            else:
                out.append(c)
                self.i += 1
        raise ValueError("unterminated string")

    def parse_value(self):
        self._skip_ws()
        c = self.s[self.i]
        if c == "{":
            return self._parse_table()
        if c in "\"'":
            return self._parse_string()
        # L["..."] localization wrapper -> inner string
        if self.s.startswith("L[", self.i):
            self.i += 2
            val = self.parse_value()
            self._skip_ws()
            assert self.s[self.i] == "]", "expected ] closing L[...]"
            self.i += 1
            return val
        m = re.match(r"-?\d+\.?\d*(?:[eE][+-]?\d+)?", self.s[self.i :])
        if m:
            self.i += m.end()
            text = m.group(0)
            return float(text) if ("." in text or "e" in text or "E" in text) else int(text)
        if self.s.startswith("true", self.i):
            self.i += 4
            return True
        if self.s.startswith("false", self.i):
            self.i += 5
            return False
        if self.s.startswith("nil", self.i):
            self.i += 3
            return None
        raise ValueError(f"unexpected token at {self.i}: {self.s[self.i:self.i+20]!r}")

    def _parse_key(self):
        """Parse a `[expr]` or bareword key; return the key or None for positional."""
        self._skip_ws()
        if self.s[self.i] == "[":
            self.i += 1
            key = self.parse_value()
            self._skip_ws()
            assert self.s[self.i] == "]", "expected ] closing key"
            self.i += 1
            self._skip_ws()
            assert self.s[self.i] == "=", "expected = after [key]"
            self.i += 1
            return key
        m = re.match(r"[A-Za-z_]\w*\s*=", self.s[self.i :])
        if m and not self.s.startswith("==", self.i + m.end() - 2):
            name = m.group(0)[:-1].strip()
            self.i += m.end()
            return name
        return None  # positional value

    def _parse_table(self) -> dict:
        assert self.s[self.i] == "{"
        self.i += 1
        result = {}
        positional = 0
        while True:
            self._skip_ws()
            if self.s[self.i] == "}":
                self.i += 1
                return result
            key = self._parse_key()
            value = self.parse_value()
            if key is None:
                positional += 1
                result[positional] = value
            else:
                result[key] = value
            self._skip_ws()
            if self.s[self.i] in ",;":
                self.i += 1


def _balanced_block(text: str, start_brace: int) -> str:
    """Return the `{...}` substring starting at `start_brace`, brace-balanced and
    string-aware."""
    depth = 0
    i = start_brace
    while i < len(text):
        c = text[i]
        if c in "\"'":
            i += 1
            while i < len(text) and text[i] != c:
                i += 2 if text[i] == "\\" else 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start_brace : i + 1]
        i += 1
    raise ValueError("unbalanced braces")


def _find_table(text: str, lua_key: str):
    """Find `<lua_key> = {` and return the parsed table, or None."""
    m = re.search(re.escape(lua_key) + r"\s*=\s*\{", text)
    if not m:
        return None
    block = _balanced_block(text, m.end() - 1)
    return LuaParser(block).parse_value()


def _clone_pos(c: dict) -> dict:
    """A single clone's map position, plus its patrol waypoints when present.
    `patrol` is a positional Lua table ([1]={x,y}, [2]=...); keep it ordered and
    omit it entirely when absent so the JSON stays compact."""
    pos = {
        "x": c.get("x", 0),
        "y": c.get("y", 0),
        "sublevel": c.get("sublevel", 1),
    }
    patrol = c.get("patrol")
    if isinstance(patrol, dict):
        pts = [
            {"x": p.get("x", 0), "y": p.get("y", 0)}
            for _, p in sorted(patrol.items())
            if isinstance(p, dict)
        ]
        if pts:
            pos["patrol"] = pts
    return pos


def _map_geometry(text: str) -> dict:
    """Travel-time geometry the SimC delay estimate needs: the Blizzard UiMap id
    (`MDT.mapInfo[dungeonIndex].mapID`, used downstream to look up world-yard
    bounds) and the dungeon entrance (the `dungeonEntrance` POI in
    `MDT.mapPOIs[dungeonIndex]`, the start point for the first pull's delay).
    `yards_per_unit` and the keystone timer are joined from Blizzard DBC later and
    are NOT produced here."""
    geo = {}
    info = _find_table(text, "MDT.mapInfo[dungeonIndex]")
    if isinstance(info, dict) and info.get("mapID"):
        geo["mapId"] = info["mapID"]
    pois = _find_table(text, "MDT.mapPOIs[dungeonIndex]")
    if isinstance(pois, dict):
        for sublevel, sub in sorted(pois.items()):
            if not isinstance(sub, dict):
                continue
            for poi in sub.values():
                if isinstance(poi, dict) and poi.get("type") == "dungeonEntrance":
                    geo["entrance"] = {
                        "x": poi.get("x", 0),
                        "y": poi.get("y", 0),
                        "sublevel": sublevel if isinstance(sublevel, int) else 1,
                    }
                    return geo  # one entrance per dungeon
    return geo


def extract_dungeon(text: str, idx: int):
    enemies_raw = _find_table(text, f"MDT.dungeonEnemies[dungeonIndex]")
    if enemies_raw is None:
        return None

    enemies = {}
    for enemy_idx, e in enemies_raw.items():
        if not isinstance(e, dict) or "id" not in e:
            continue
        raw_clones = e.get("clones") if isinstance(e.get("clones"), dict) else {}
        clones = {
            str(ci): _clone_pos(c)
            for ci, c in raw_clones.items()
            if isinstance(c, dict)
        }
        enemies[str(enemy_idx)] = {
            "id": e["id"],
            "name": e.get("name", ""),
            "count": e.get("count", 0),
            "health": e.get("health", 0),
            "creatureType": e.get("creatureType", "Humanoid"),
            "isBoss": bool(e.get("isBoss", False)),
            "ignoreFortified": bool(e.get("ignoreFortified", False)),
            "scale": e.get("scale", 1),
            "clones": clones,
        }

    name_m = re.search(r"MDT.dungeonList\[dungeonIndex\]\s*=\s*", text)
    name = ""
    if name_m:
        name = LuaParser(text[name_m.end() :]).parse_value()
    total = _find_table(text, "MDT.dungeonTotalCount[dungeonIndex]") or {}
    sublevels_raw = _find_table(text, "MDT.dungeonSubLevels[dungeonIndex]") or {}
    sublevels = [
        {"index": k, "name": v}
        for k, v in sorted(sublevels_raw.items())
        if isinstance(k, int)
    ]

    return {
        "name": name,
        "totalCount": total.get("normal", 0),
        "sublevels": sublevels,
        **_map_geometry(text),
        "enemies": enemies,
    }


def mdt_version(repo: Path) -> str:
    """Addon version from the .toc (`## Version: 6.1.16`), or "" if absent.
    Stamped into the JSON so the app can tell which MDT data snapshot the
    enemy positions come from (they shift between MDT releases)."""
    toc = repo / "MythicDungeonTools.toc"
    try:
        m = re.search(r"^## Version:\s*(\S+)", toc.read_text(encoding="utf-8"), re.M)
        return m.group(1) if m else ""
    except OSError:
        return ""


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    repo = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    only = None
    if "--only" in sys.argv:
        only = {int(x) for x in sys.argv[sys.argv.index("--only") + 1].split(",")}

    result = {}
    for lua_file in sorted(repo.rglob("*.lua")):
        text = lua_file.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"local dungeonIndex\s*=\s*(\d+)", text)
        if not m:
            continue
        idx = int(m.group(1))
        if only is not None and idx not in only:
            continue
        if "MDT.dungeonEnemies[dungeonIndex]" not in text:
            continue
        try:
            dungeon = extract_dungeon(text, idx)
        except Exception as exc:  # noqa: BLE001 - report and skip bad files
            print(f"  ! skipped {lua_file.name} (idx {idx}): {exc}", file=sys.stderr)
            continue
        if dungeon:
            result[str(idx)] = dungeon
            print(f"  extracted dungeon {idx}: {dungeon['name']} "
                  f"({len(dungeon['enemies'])} enemies, {dungeon['totalCount']} forces)")

    out = {"mdtVersion": mdt_version(repo), "dungeons": result}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(result)} dungeon(s) (MDT {out['mdtVersion'] or 'unknown'}) to {out_path}")


if __name__ == "__main__":
    main()
