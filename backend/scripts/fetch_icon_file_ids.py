#!/usr/bin/env python3
"""Resolve icon FileDataIDs for icons Blizzard's CDN won't serve by name.

Blizzard's render CDN addresses icons by FileDataID
(``/icons/56/7871829.jpg``). The icon-*name* path
(``/icons/56/inv_chest_mail_foo_c_01.jpg``) is a legacy alias that exists only
for older art — requesting a name Blizzard never aliased returns HTTP 403 with
an S3 ``AccessDenied`` body. Raidbots' exports carry only names, so roughly a
quarter of current-season loot icons have no working URL.

``icon-paths.txt`` (FileDataID,path, from Blizzard's ManifestInterfaceData) is
the offline oracle for which names still work: it tops out around FileDataID
4.9M while current icons are ~7.8M. Any icon name absent from it is at risk.

This script takes those at-risk names, asks Blizzard's media API for the
FileDataID of an item/spell that uses each one, and writes a
``<name> -> <fileDataId>`` map. The backend serves it and the frontend
substitutes the ID when building icon URLs.

Run after fetch-data.sh, from backend/resources/data:
    BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... \
        python ../../scripts/fetch_icon_file_ids.py .

Credentials come from https://develop.battle.net/access/clients.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Endpoints that expose file_data_id. Currency has no media endpoint, so those
# icons keep their name (they are old enough that the name alias exists).
KINDS = ("item", "spell")

# Distinct ids tried per icon name before giving up — not every id has media.
MAX_CANDIDATES = 3

WORKERS = 16


def load_named_icons(data_dir: Path) -> set:
    """Icon names Blizzard still serves by name, from icon-paths.txt."""
    names = set()
    path = data_dir / "icon-paths.txt"
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if "," not in line:
                continue
            _, filepath = line.split(",", 1)
            base = filepath.strip().replace("/", "\\").split("\\")[-1]
            names.add(base.rsplit(".", 1)[0].lower())
    return names


def build_worklist(data_dir: Path, named: set) -> dict:
    """Map each at-risk icon name to a few ids that use it: {name: (kind, [ids])}."""
    lookup = json.loads((data_dir / "icon-lookup.json").read_text(encoding="utf-8"))
    work = {}
    for kind in KINDS:
        for entry_id, icon in lookup.get(kind, {}).items():
            if not icon:
                continue
            icon = icon.lower()
            if icon in named:
                continue
            if icon in work and len(work[icon][1]) >= MAX_CANDIDATES:
                continue
            work.setdefault(icon, (kind, []))[1].append(int(entry_id))
    return work


def get_token(client_id: str, client_secret: str) -> str:
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request("https://oauth.battle.net/token", data=body)
    raw = f"{client_id}:{client_secret}".encode()
    req.add_header("Authorization", "Basic " + base64.b64encode(raw).decode())
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)["access_token"]


def fetch_file_data_id(kind: str, entry_id: int, token: str, region: str):
    """Return the icon FileDataID for one item/spell, or None."""
    url = (
        f"https://{region}.api.blizzard.com/data/wow/media/{kind}/{entry_id}"
        f"?namespace=static-{region}&locale=en_US"
    )
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.load(resp)
            for asset in payload.get("assets", []):
                if asset.get("key") == "icon" and asset.get("file_data_id"):
                    return int(asset["file_data_id"])
            return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2**attempt)
                continue
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(2**attempt)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("data_dir", type=Path, help="directory holding the Raidbots exports")
    ap.add_argument("--out", default="icon-file-ids.json", help="output filename")
    ap.add_argument("--region", default=os.environ.get("BLIZZARD_REGION", "eu"))
    args = ap.parse_args()

    # BLIZZARD_TOKEN short-circuits the OAuth exchange with an existing access
    # token — handy for a one-off run, but tokens expire in 24h so builds should
    # use the client id/secret.
    token = os.environ.get("BLIZZARD_TOKEN")
    client_id = os.environ.get("BLIZZARD_CLIENT_ID")
    client_secret = os.environ.get("BLIZZARD_CLIENT_SECRET")
    if not token and not (client_id and client_secret):
        print(
            "error: set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET "
            "(https://develop.battle.net/access/clients), or BLIZZARD_TOKEN",
            file=sys.stderr,
        )
        return 2

    data_dir = args.data_dir
    named = load_named_icons(data_dir)
    work = build_worklist(data_dir, named)
    print(f"{len(named):,} icons serve by name; {len(work):,} at-risk icons to resolve")

    # Reuse anything already resolved — a name->FileDataID pairing never changes,
    # so a re-run after a data refresh only fetches what is new.
    out_path = data_dir / args.out
    resolved = {}
    if out_path.exists():
        resolved = {k: int(v) for k, v in json.loads(out_path.read_text()).items()}
        work = {k: v for k, v in work.items() if k not in resolved}
        print(f"{len(resolved):,} already known; {len(work):,} left to fetch")

    if not work:
        print("nothing to do")
        return 0

    if not token:
        token = get_token(client_id, client_secret)

    def resolve(item):
        icon, (kind, ids) = item
        for entry_id in ids[:MAX_CANDIDATES]:
            fdid = fetch_file_data_id(kind, entry_id, token, args.region)
            if fdid:
                return icon, fdid
        return icon, None

    done = failed = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for icon, fdid in pool.map(resolve, work.items()):
            if fdid:
                resolved[icon] = fdid
            else:
                failed += 1
            done += 1
            if done % 500 == 0:
                print(f"  {done:,}/{len(work):,} ({failed:,} unresolved)")

    out_path.write_text(
        json.dumps(dict(sorted(resolved.items())), indent=0, sort_keys=True),
        encoding="utf-8",
    )
    print(f"wrote {out_path} — {len(resolved):,} icons ({failed:,} unresolved)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
