#!/usr/bin/env bash
# The one place that answers "is this tree green?".
#
# hooks/pre-commit, the .claude/skills/{implement,ship} skills and
# .github/workflows all run these same commands, so "passed locally" and
# "passed in CI" cannot drift apart.
#
# Usage:
#   bash scripts/verify.sh                   # every gate this machine can run
#   bash scripts/verify.sh --fast            # pre-commit subset: formatting + unit tests
#   bash scripts/verify.sh --rust            # one area only (combinable)
#   bash scripts/verify.sh --frontend --desktop
#
# Exit 0 = every gate that could run passed. Exit 1 = a gate failed.
# A gate whose toolchain is absent is SKIPPED, never silently dropped: it is
# listed in the summary so you know what CI still has to prove.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAST=0
sel=""

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

for a in "$@"; do
  case "$a" in
    --fast) FAST=1 ;;
    --rust|--frontend|--desktop) sel="$sel ${a#--}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "verify: unknown argument '$a'"; usage; exit 2 ;;
  esac
done
[ -z "$sel" ] && sel=" rust frontend desktop "
has() { [[ " $sel " == *" $1 "* ]]; }

pass=(); fail=(); skip=()

gate() { # gate <label> <dir> <command...>
  local label="$1" dir="$2"; shift 2
  printf '\n\033[1;34m> %s\033[0m\n' "$label"
  if (cd "$dir" && "$@"); then
    pass+=("$label")
  else
    printf '\033[31m  FAILED: %s\033[0m\n' "$label"
    fail+=("$label")
  fi
}

skipped() { # skipped <label> <why>
  printf '\n\033[33m> %s — SKIPPED: %s\033[0m\n' "$1" "$2"
  skip+=("$1 — $2")
}

# ---------------------------------------------------------------- backend (Rust)
if has rust; then
  if ! command -v cargo >/dev/null 2>&1; then
    skipped "rust" "no cargo on PATH — CI (lint.yml) covers fmt, clippy and tests"
  else
    gate "rust: fmt" "$ROOT/backend" cargo fmt --all -- --check
    [ "$FAST" = 0 ] && gate "rust: clippy" "$ROOT/backend" \
      cargo clippy --all-targets --all-features -- -D warnings

    # Tests load game data from resources/data-compacted (see core/src/lib.rs).
    # Derive it from the raw Raidbots data when possible; refuse to pretend the
    # suite ran when neither exists.
    if [ ! -f "$ROOT/backend/resources/data-compacted/bonuses.json" ] \
       && [ -f "$ROOT/backend/resources/data/metadata.json" ]; then
      gate "rust: compact game data" "$ROOT" \
        node backend/scripts/compact-data.js backend/resources/data backend/resources/data-compacted
    fi

    if [ -f "$ROOT/backend/resources/data-compacted/bonuses.json" ]; then
      if [ "$FAST" = 1 ]; then
        gate "rust: core lib tests" "$ROOT/backend" cargo test -p simhammer-core --lib --quiet
      else
        gate "rust: tests" "$ROOT/backend" cargo test --all-features
      fi
    else
      skipped "rust: tests" "no game data — run 'bash backend/resources/data/fetch-data.sh' first"
    fi
  fi
fi

# ------------------------------------------------------------------- frontend
if has frontend; then
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    if [ "$FAST" = 1 ]; then
      skipped "frontend" "node_modules missing — run 'cd frontend && npm ci'"
    else
      gate "frontend: npm ci" "$ROOT/frontend" npm ci
    fi
  fi

  if [ -d "$ROOT/frontend/node_modules" ]; then
    gate "frontend: prettier" "$ROOT/frontend" npm run format:check

    # Hermetic suites first. test-talents.cjs is the one suite that reads real
    # game data (backend/resources/data/talents.json), so it is gated on that
    # file existing instead of failing on a fresh clone.
    gate "frontend: unit tests" "$ROOT/frontend" \
      bash -c 'node --test $(ls scripts/test-*.cjs | grep -v test-talents.cjs)'
    if [ -f "$ROOT/backend/resources/data/talents.json" ]; then
      gate "frontend: talent tests" "$ROOT/frontend" node --test scripts/test-talents.cjs
    else
      skipped "frontend: talent tests" "needs backend/resources/data/talents.json — 'curl -sL -o backend/resources/data/talents.json https://www.raidbots.com/static/data/live/talents.json'"
    fi
    if [ "$FAST" = 0 ]; then
      gate "frontend: tsc" "$ROOT/frontend" npx tsc --noEmit
      gate "frontend: eslint" "$ROOT/frontend" npm run lint
      gate "frontend: locales" "$ROOT/frontend" npm run check:locales
    fi
  fi
fi

# -------------------------------------------------------------------- desktop
# These tests require no dependencies at all (node:test + local modules), so
# they run whether or not desktop/node_modules has been installed.
if has desktop; then
  gate "desktop: unit tests" "$ROOT/desktop" \
    node --test src/main/deeplink.test.js src/main/windowBounds.test.js
fi

# -------------------------------------------------------------------- summary
printf '\n\033[1m── verify summary ──\033[0m\n'
for p in "${pass[@]:-}"; do [ -n "$p" ] && printf '\033[32m  pass\033[0m  %s\n' "$p"; done
for s in "${skip[@]:-}"; do [ -n "$s" ] && printf '\033[33m  skip\033[0m  %s\n' "$s"; done
for f in "${fail[@]:-}"; do [ -n "$f" ] && printf '\033[31m  FAIL\033[0m  %s\n' "$f"; done

if [ "${#fail[@]}" -gt 0 ]; then
  printf '\n\033[31m%s gate(s) failed.\033[0m\n' "${#fail[@]}"
  exit 1
fi
printf '\n\033[32mAll runnable gates passed.\033[0m'
[ "${#skip[@]}" -gt 0 ] && printf ' \033[33m%s skipped (see above).\033[0m' "${#skip[@]}"
printf '\n'
