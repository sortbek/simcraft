# Top Gear "Add Item" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add item" button to Top Gear that opens a modal with the full DropFinder catalog, lets the user pick any item at a chosen item level, and inserts it as an auto-selected alternative in its slot group.

**Architecture:** A new backend endpoint `POST /api/top-gear/resolve-drops` turns DropFinder drop payloads into authoritative `ResolvedItem`s via the existing `gear_resolver` (resolved in isolation: character context + drops only). The DropFinder browser is extracted into a reusable `<LootBrowser>`; a new `AddItemModal` renders it with a per-row item-level dropdown, calls the endpoint, and merges returned items into Top Gear state as `loot`-origin alternatives.

**Tech Stack:** Rust (actix-web) backend; Next.js 15 / React / TypeScript frontend. No frontend test runner exists — frontend is verified by typecheck/build/lint + manual app checks (per project decision). Backend uses Rust `#[cfg(test)]` tests with `test_support::ensure_game_data_loaded()`.

## Global Constraints

- Branch: all work on `feat/topgear-add-item` (already created). Never commit to `master`.
- Commits: NEVER add a `Co-Authored-By: Claude` trailer.
- Frontend: no new test framework. Verify FE with `cd frontend && npx tsc --noEmit` + `npm run lint` + manual checks. Match existing component/style conventions.
- Backend: every new pure function gets a Rust unit test. Run `cd backend && cargo test -p simhammer-core <name>`.
- Variant items (Void-Forged / Catalyst) ARE in scope for v1. DropFinder already encodes the variant into `item_id`/`bonus_ids`; the endpoint only re-stamps `is_void_forge`/`is_catalyst` onto the resolved item.
- Added items get `origin: 'loot'`.
- Reuse existing helpers verbatim where they exist: `mergeAlternative`, `selectAlternative` (currently file-local in `TopGearItemSelector.tsx` — promote to a shared module in Task 6), `toLocalItem`, `appendLocalItems`, `buildTopGearUid`, `resolveUpgrade`, `getTrackInfo`.

---

## Phase 1 — Backend endpoint (TDD)

### Task 1: Drop → RawParsedItem pure builder + variant-flag mapping

**Files:**
- Create: `backend/core/src/server/resolve_drops.rs`
- Modify: `backend/core/src/server/mod.rs` (add `mod resolve_drops;`)
- Test: inline `#[cfg(test)]` module in `resolve_drops.rs`

**Interfaces:**
- Produces: `pub(super) fn drop_to_raw_item(drop: &serde_json::Value) -> Option<crate::types::RawParsedItem>` and `pub(super) fn primary_slot_for_inv_type(inv_type: u64) -> &'static str`.

- [ ] **Step 1: Write the failing test**

Add to a new file `backend/core/src/server/resolve_drops.rs`:

```rust
use crate::addon_parser;
use crate::gear_resolver;
use crate::types::{ItemOrigin, ParseResult, RawParsedItem, ResolvedItem};
use serde_json::Value;
use std::collections::HashMap;

/// Map an inventory type to a representative gear slot for `RawParsedItem.raw_slot`.
/// The resolver fans items to all eligible slots via item_db; raw_slot is only a
/// fallback, so a single representative slot per inv_type is sufficient.
pub(super) fn primary_slot_for_inv_type(inv_type: u64) -> &'static str {
    match inv_type {
        1 => "head",
        2 => "neck",
        3 => "shoulder",
        5 | 20 => "chest",
        6 => "waist",
        7 => "legs",
        8 => "feet",
        9 => "wrist",
        10 => "hands",
        11 => "finger1",
        12 => "trinket1",
        16 => "back",
        14 | 22 | 23 => "off_hand",
        _ => "main_hand",
    }
}

/// Build a loot-origin RawParsedItem from a DropFinder drop payload.
/// `bonus_ids` is taken verbatim (the frontend already composed the final list:
/// chosen item-level track bonus + extra_bonus_ids).
pub(super) fn drop_to_raw_item(drop: &Value) -> Option<RawParsedItem> {
    let item_id = drop.get("item_id").and_then(|v| v.as_u64())?;
    if item_id == 0 {
        return None;
    }
    let ilevel = drop.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
    let name = drop
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let inv_type = drop
        .get("inventory_type")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let bonus_ids: Vec<u64> = drop
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();

    let bonus_str = bonus_ids
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join("/");
    let simc_string = if bonus_str.is_empty() {
        format!(",id={}", item_id)
    } else {
        format!(",id={},bonus_id={}", item_id, bonus_str)
    };

    Some(RawParsedItem {
        raw_slot: primary_slot_for_inv_type(inv_type).to_string(),
        simc_string,
        item_id,
        ilevel,
        name,
        bonus_ids,
        enchant_id: 0,
        gem_id: 0,
        origin: ItemOrigin::Loot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn drop_to_raw_item_builds_simc_and_slot() {
        let drop = json!({
            "item_id": 212448,
            "ilevel": 639,
            "name": "Test Ring",
            "inventory_type": 11,
            "bonus_ids": [10, 20]
        });
        let item = drop_to_raw_item(&drop).expect("some");
        assert_eq!(item.item_id, 212448);
        assert_eq!(item.raw_slot, "finger1");
        assert_eq!(item.origin, ItemOrigin::Loot);
        assert_eq!(item.simc_string, ",id=212448,bonus_id=10/20");
        assert_eq!(item.bonus_ids, vec![10, 20]);
    }

    #[test]
    fn drop_to_raw_item_no_bonus_omits_bonus_clause() {
        let drop = json!({ "item_id": 5, "inventory_type": 1, "bonus_ids": [] });
        let item = drop_to_raw_item(&drop).expect("some");
        assert_eq!(item.simc_string, ",id=5");
        assert_eq!(item.raw_slot, "head");
    }

    #[test]
    fn drop_to_raw_item_rejects_zero_id() {
        assert!(drop_to_raw_item(&json!({ "item_id": 0 })).is_none());
        assert!(drop_to_raw_item(&json!({})).is_none());
    }
}
```

Then register the module in `backend/core/src/server/mod.rs` — add `mod resolve_drops;` alongside the other `mod ...;` handler declarations (search for `mod droptimizer_handlers;` and add the line next to it).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && cargo test -p simhammer-core resolve_drops::tests`
Expected: FAIL to compile until the module is registered, then PASS once Step 1 code compiles. (If it already passes, the implementation in Step 1 is complete — proceed.)

- [ ] **Step 3: Confirm implementation present**

The implementation is included in Step 1. No additional code needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && cargo test -p simhammer-core resolve_drops::tests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/src/server/resolve_drops.rs backend/core/src/server/mod.rs
git commit -m "feat(top-gear): drop->RawParsedItem builder for resolve-drops"
```

---

### Task 2: resolve_drops_to_items + handler + route

**Files:**
- Modify: `backend/core/src/server/resolve_drops.rs` (add `resolve_drops_to_items` + handler)
- Modify: `backend/core/src/server/types.rs` (add `ResolveDropsRequest`)
- Modify: `backend/core/src/server/api_routes.rs` (register route)
- Test: inline `#[cfg(test)]` in `resolve_drops.rs` (fixture-backed integration test)

**Interfaces:**
- Consumes: `drop_to_raw_item` (Task 1), `gear_resolver::resolve_gear`, `addon_parser::parse_simc_input`.
- Produces: `pub(super) fn resolve_drops_to_items(simc_input: &str, drops: &[Value]) -> Vec<ResolvedItem>` and `pub(super) async fn resolve_drops(req: web::Json<ResolveDropsRequest>) -> HttpResponse`.

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)] mod tests` in `resolve_drops.rs`:

```rust
    use crate::test_support::ensure_game_data_loaded;

    // A minimal class/spec header so resolve_gear has character context.
    const MAGE_HEADER: &str = "mage=\"Test\"\nlevel=80\nspec=frost\n";

    #[test]
    fn resolve_drops_returns_enriched_alternative() {
        ensure_game_data_loaded();
        // RING_ITEM_ID must be a finger item (inventory_type 11) present in
        // backend/resources/data-compacted/equippable-items-full.json. Find one:
        //   grep -o '"[0-9]*":{"[^}]*"inventoryType":11' equippable-items-full.json | head
        const RING_ITEM_ID: u64 = REPLACE_WITH_FIXTURE_RING_ID;
        let drops = vec![json!({
            "item_id": RING_ITEM_ID,
            "inventory_type": 11,
            "bonus_ids": [],
            "ilevel": 600
        })];
        let items = resolve_drops_to_items(MAGE_HEADER, &drops);
        // A ring fans to BOTH finger slots.
        let slots: Vec<&str> = items.iter().map(|i| i.slot.as_str()).collect();
        assert!(slots.contains(&"finger1"), "got slots {:?}", slots);
        assert!(slots.contains(&"finger2"), "got slots {:?}", slots);
        assert!(items.iter().all(|i| i.item_id == RING_ITEM_ID));
        assert!(items.iter().all(|i| i.origin == ItemOrigin::Loot));
        assert!(items.iter().all(|i| !i.is_void_forge && !i.is_catalyst));
    }

    #[test]
    fn resolve_drops_stamps_variant_flags() {
        ensure_game_data_loaded();
        const HEAD_ITEM_ID: u64 = REPLACE_WITH_FIXTURE_HEAD_ID; // inventory_type 1
        let drops = vec![json!({
            "item_id": HEAD_ITEM_ID,
            "inventory_type": 1,
            "bonus_ids": [],
            "ilevel": 600,
            "is_catalyst": true
        })];
        let items = resolve_drops_to_items(MAGE_HEADER, &drops);
        assert!(!items.is_empty());
        assert!(items.iter().all(|i| i.is_catalyst));
    }
```

> NOTE: Replace `REPLACE_WITH_FIXTURE_RING_ID` / `REPLACE_WITH_FIXTURE_HEAD_ID` with real item ids found in `backend/resources/data-compacted/equippable-items-full.json` (use the grep in the comment). These literals are the ONLY values to discover from the fixture; the assertions are structural and must not change.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && cargo test -p simhammer-core resolve_drops::tests::resolve_drops_returns_enriched_alternative`
Expected: FAIL — `resolve_drops_to_items` not defined.

- [ ] **Step 3: Implement `resolve_drops_to_items` + handler**

Add to `resolve_drops.rs` (above the test module):

```rust
use actix_web::{web, HttpResponse};
use serde_json::json;

/// Resolve drops in isolation: parse the simc input only for character/spec
/// context, then resolve a ParseResult containing ONLY the drops (origin Loot).
/// resolve_gear places each drop as an alternative in every eligible slot
/// (rings -> finger1+finger2, trinkets -> trinket1+trinket2). The resolver
/// never infers variant status, so re-stamp is_void_forge / is_catalyst from
/// the drop payload (matched on item_id + sorted bonus_ids).
pub(super) fn resolve_drops_to_items(simc_input: &str, drops: &[Value]) -> Vec<ResolvedItem> {
    let parsed = addon_parser::parse_simc_input(simc_input);
    let raw_items: Vec<RawParsedItem> = drops.iter().filter_map(drop_to_raw_item).collect();
    if raw_items.is_empty() {
        return Vec::new();
    }

    let drop_parse = ParseResult {
        items: raw_items,
        character: parsed.character,
        base_profile: String::new(),
        talent_loadouts: Vec::new(),
    };
    let resolved = gear_resolver::resolve_gear(&drop_parse);

    // (item_id, sorted bonus_ids) -> (is_void_forge, is_catalyst)
    let mut flags: HashMap<(u64, Vec<u64>), (bool, bool)> = HashMap::new();
    for drop in drops {
        let Some(item_id) = drop.get("item_id").and_then(|v| v.as_u64()) else {
            continue;
        };
        let mut b: Vec<u64> = drop
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
            .unwrap_or_default();
        b.sort();
        let vf = drop.get("is_void_forge").and_then(|v| v.as_bool()).unwrap_or(false);
        let cat = drop.get("is_catalyst").and_then(|v| v.as_bool()).unwrap_or(false);
        flags.insert((item_id, b), (vf, cat));
    }

    let mut out: Vec<ResolvedItem> = Vec::new();
    for slot_res in resolved.slots.into_values() {
        for mut alt in slot_res.alternatives {
            let mut key_b = alt.bonus_ids.clone();
            key_b.sort();
            if let Some(&(vf, cat)) = flags.get(&(alt.item_id, key_b)) {
                alt.is_void_forge = vf;
                alt.is_catalyst = cat;
            }
            out.push(alt);
        }
    }
    out
}

pub(super) async fn resolve_drops(
    req: web::Json<crate::server::types::ResolveDropsRequest>,
) -> HttpResponse {
    let items = resolve_drops_to_items(&req.simc_input, &req.drop_items);
    HttpResponse::Ok().json(json!({ "items": items }))
}
```

Add to `backend/core/src/server/types.rs` (next to `DroptimizerRequest`):

```rust
#[derive(Debug, Deserialize)]
pub struct ResolveDropsRequest {
    pub simc_input: String,
    pub drop_items: Vec<Value>,
}
```

Register the route in `backend/core/src/server/api_routes.rs` — inside `configure`, add a sibling to the existing top-gear routes:

```rust
        .route(
            "/api/top-gear/resolve-drops",
            web::post().to(resolve_drops::resolve_drops),
        )
```

(Ensure `use super::resolve_drops;` or the module path resolves — match how `top_gear_handlers` / `droptimizer_handlers` are referenced in that file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && cargo test -p simhammer-core resolve_drops::tests`
Expected: PASS (5 tests). Then `cd backend && cargo build` to confirm the route wiring compiles.

- [ ] **Step 5: Commit**

```bash
git add backend/core/src/server/resolve_drops.rs backend/core/src/server/types.rs backend/core/src/server/api_routes.rs
git commit -m "feat(top-gear): /api/top-gear/resolve-drops endpoint"
```

---

## Phase 2 — Frontend: reusable LootBrowser (behavior-preserving)

### Task 3: Add additive `renderLevel` render-prop to ItemTable

**Files:**
- Modify: `frontend/src/app/components/loot/ItemTable.tsx`

**Interfaces:**
- Produces: optional prop `renderLevel?: (item: DropItem, tracks: UpgradeTracks) => React.ReactNode` on `ItemTableProps`. When provided, it replaces the static `{resolved.ilvl}` cell; when omitted, behaviour is unchanged. (Two args from the start so Task 7 needs no signature change.)

- [ ] **Step 1: Add the optional prop**

In `ItemTableProps` (after `spec: string;`), add:

```typescript
  /** When set, renders a custom item-level control per row instead of the
   *  static resolved ilvl. Used by the Top Gear "add item" modal. */
  renderLevel?: (item: DropItem, tracks: UpgradeTracks) => ReactNode;
```

Add `renderLevel,` to the destructured params and import the type (`import { useMemo, useState, type ReactNode } from 'react';`). `UpgradeTracks` is already imported from `./types`.

- [ ] **Step 2: Use it in the level cell**

Replace the level cell (currently):

```tsx
                  <div className="col-span-2 text-center">
                    <span className="font-headline text-xs font-black tabular-nums text-on-surface">
                      {resolved.ilvl}
                    </span>
                  </div>
```

with:

```tsx
                  <div className="col-span-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {renderLevel ? (
                      renderLevel(item, upgradeTracks)
                    ) : (
                      <span className="font-headline text-xs font-black tabular-nums text-on-surface">
                        {resolved.ilvl}
                      </span>
                    )}
                  </div>
```

(The `stopPropagation` keeps clicks on the dropdown from toggling row selection.)

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors. Manually load DropFinder — the ilvl column is unchanged (renderLevel undefined).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/loot/ItemTable.tsx
git commit -m "feat(loot): optional renderLevel prop on ItemTable"
```

---

### Task 4: Extract `<LootBrowser>` from DropFinderContent (behavior-preserving)

**Files:**
- Create: `frontend/src/app/components/loot/LootBrowser.tsx`
- Modify: `frontend/src/app/drop-finder/DropFinderContent.tsx`

**Interfaces:**
- Produces: `<LootBrowser>` with a single prop shape. The host supplies the footer via a render-prop that receives the current selection + difficulty context, so submission logic stays out of the browser.

```typescript
export interface LootBrowserRenderState {
  selectedDrops: DropItem[];   // items in visibleDrops whose dropUid is selected
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
  hasSelection: boolean;
}

export interface LootBrowserProps {
  /** Hide the global difficulty + upgrade-LEVEL grid only (Top Gear modal uses a
   *  per-item ilvl dropdown). Instance pools and the void-forge/catalyst toggles
   *  stay visible. Default false. */
  hideDifficultyControls?: boolean;
  /** Custom per-row item-level control, forwarded to ItemTable.renderLevel. */
  renderLevel?: (item: DropItem, tracks: UpgradeTracks) => ReactNode;
  /** Renders below the table (footer / submit). */
  footer?: (state: LootBrowserRenderState) => ReactNode;
}
```

This task is a **behavior-preserving move**: cut the browsing/filtering/selection body out of `DropFinderContent` into `LootBrowser`, leaving `DropFinderContent` to render `<LootBrowser>` plus its existing submission. Do NOT change runtime behaviour of DropFinder.

**Gating detail (important):** `hideDifficultyControls` must wrap ONLY the difficulty + upgrade-level grid — the `{activeDifficulties.length > 0 && ( ...DifficultySelect/UpgradeSelect... )}` block (current lines ~651–686). The instance-pool drawers AND the void-forge/catalyst toggle row (current lines ~688–710) must REMAIN visible, since variants are in scope for v1. Do not gate the whole config card.

**Variant visibility in modal mode:** `filteredDrops` hides Void-Forged rows whose track has no VF tier at the current `difficulty`/`dungeonDiff` (current lines ~371–377). With the difficulty control hidden, default to the HIGHEST tier so VF variants resolve and stay visible: when `hideDifficultyControls` is true, on mount set `difficulty` and `dungeonDiff` to the top difficulty available for the active category (the last entry of `activeDifficulties`, mirroring how `selectedDiffInfo` reads `track`/`level`). The per-item ilvl dropdown still gives full ilvl control regardless. Note this default in a code comment.

- [ ] **Step 1: Create LootBrowser with the moved body**

Move into `LootBrowser.tsx`:
- the `useDropFinderData` hook and `Spinner` (cut from DropFinderContent),
- the `SLOT_ORDER`, `TRACK_SHORT`, `TRACK_COLORS` consts,
- all state currently in `DropFinderContent` EXCEPT `compute` and the sim-submission (`useSimSubmit`, `buildPayload`, `validate`, `submitLabel`): i.e. `category`, spec selection, `includeVoidForge`/`includeCatalyst`, `selected`, `difficulty`, `dungeonDiff`, `upgradeLevel`, instance pools, `excludedSlots`, slot-filter state, and all the derived `useMemo`s/effects (lines ~166–547 of the current file),
- the JSX from `<TalentPicker/>` through the `<ItemTable .../>` block (lines ~617–875), with these changes:
  - wrap the difficulty/upgrade card region in `{!hideDifficultyControls && ( ... )}`,
  - pass `renderLevel={renderLevel}` to `<ItemTable>`,
  - keep `difficulty`/`dungeonDiff`/`upgradeLevel`/`upgradeTracks` props on `<ItemTable>` (still drive icon quality + the default ilvl cell when `renderLevel` is absent).

At the end of LootBrowser's body, call `footer?.(state)` with `state: LootBrowserRenderState` (defined in Interfaces above), where `selectedDrops` = the items across `visibleDrops` whose `dropUid` is in `selected`, and `hasSelection = selectedDrops.length > 0`. Render `{footer?.(state)}` after the `<ItemTable>` block. The footer render-prop is the ONLY way submission/host logic enters — LootBrowser itself imports no `useSimSubmit`.

- [ ] **Step 2: Rewrite DropFinderContent to consume LootBrowser**

`DropFinderContent` becomes:

```tsx
export default function DropFinderContent() {
  const { t } = useLanguage();
  const { simcInput, hasInput } = useSimContext();
  const [compute, setCompute] = useComputeChoice('droptimizer');

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          {t('dropFinder.title')}
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">{t('dropFinder.description')}</p>
      </div>
      <LootBrowser
        footer={({ selectedDrops, difficulty, dungeonDiff, upgradeLevel, upgradeTracks, hasSelection }) => {
          const buildPayload = () => {
            if (!hasSelection) return null;
            const dropItems: DropItemPayload[] = selectedDrops.map((item) => {
              const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
              return {
                ...item,
                ilevel: resolved.ilvl,
                quality: resolved.quality,
                bonus_ids: [
                  ...(resolved.bonus_id ? [resolved.bonus_id] : []),
                  ...(item.extra_bonus_ids ?? []),
                ],
              };
            });
            return { simc_input: simcInput, drop_items: dropItems, compute_provider: compute };
          };
          return (
            <DropFinderFooter
              buildPayload={buildPayload}
              hasSelection={hasSelection}
              hasCharacter={hasInput}
              count={selectedDrops.length}
              compute={compute}
              onComputeChange={setCompute}
            />
          );
        }}
      />
    </div>
  );
}
```

Where `DropFinderFooter` is a small local component wrapping the existing `useSimSubmit({ endpoint: '/api/droptimizer/sim', buildPayload, validate })` + `<SimcDownloadBanner/>` + `<ErrorAlert/>` + `<ConfigFooter/>` and the `submitLabel` logic moved out of the old body. (Keep the exact strings/labels.)

- [ ] **Step 3: Verify behaviour-preserving**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean. Then manually exercise DropFinder end-to-end: category switch, instance pool, spec toggles, difficulty + upgrade level, void-forge/catalyst toggles, slot filter, search, select/deselect, and submit a droptimizer sim. Behaviour must match pre-change. Fix any regressions before committing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/loot/LootBrowser.tsx frontend/src/app/drop-finder/DropFinderContent.tsx
git commit -m "refactor(loot): extract reusable LootBrowser from DropFinderContent"
```

---

## Phase 3 — Frontend: AddItemModal + integration

### Task 5: Item-level options helper

**Files:**
- Create: `frontend/src/app/components/loot/itemLevelOptions.ts`

**Interfaces:**
- Produces:
  - `export interface IlvlOption { ilvl: number; bonus_id: number; quality: number; }`
  - `export function buildItemLevelOptions(item: DropItem, tracks: UpgradeTracks): IlvlOption[]` — every achievable ilvl across the item's `difficulty_info` and `dungeon_info` tracks, deduped by ilvl, sorted descending (max first).
  - `export function dropPayloadAtIlvl(item: DropItem, option: IlvlOption): DropItemPayload` — mirrors DropFinder's `buildPayload` composition.

- [ ] **Step 1: Implement**

```typescript
import type { DropItem, DropItemPayload, TrackInfo, UpgradeTracks } from './types';

export interface IlvlOption {
  ilvl: number;
  bonus_id: number;
  quality: number;
}

/** All achievable item levels for a drop: expand each difficulty/dungeon track
 *  through its upgrade levels, plus any non-track base entry. Deduped by ilvl,
 *  highest first (so the first option is the max ilvl default). */
export function buildItemLevelOptions(item: DropItem, tracks: UpgradeTracks): IlvlOption[] {
  const byIlvl = new Map<number, IlvlOption>();
  const sources: Record<string, TrackInfo>[] = [];
  if (item.difficulty_info) sources.push(item.difficulty_info);
  if (item.dungeon_info) sources.push(item.dungeon_info);

  for (const source of sources) {
    for (const info of Object.values(source)) {
      if (info.track && tracks[info.track]) {
        for (const lvl of tracks[info.track]) {
          if (!byIlvl.has(lvl.ilvl)) {
            byIlvl.set(lvl.ilvl, { ilvl: lvl.ilvl, bonus_id: lvl.bonus_id, quality: lvl.quality });
          }
        }
      } else if (!byIlvl.has(info.ilvl)) {
        byIlvl.set(info.ilvl, { ilvl: info.ilvl, bonus_id: info.bonus_id, quality: info.quality });
      }
    }
  }

  if (byIlvl.size === 0) {
    byIlvl.set(item.ilevel, { ilvl: item.ilevel, bonus_id: 0, quality: item.quality });
  }
  return [...byIlvl.values()].sort((a, b) => b.ilvl - a.ilvl);
}

/** Compose a droptimizer/resolve-drops payload at a chosen ilvl. Matches
 *  DropFinderContent.buildPayload: bonus_ids = [chosen track bonus] + extra. */
export function dropPayloadAtIlvl(item: DropItem, option: IlvlOption): DropItemPayload {
  return {
    ...item,
    ilevel: option.ilvl,
    quality: option.quality,
    bonus_ids: [...(option.bonus_id ? [option.bonus_id] : []), ...(item.extra_bonus_ids ?? [])],
  };
}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/loot/itemLevelOptions.ts
git commit -m "feat(loot): item-level option derivation helper"
```

---

### Task 6: Promote mergeAlternative / selectAlternative to a shared module

**Files:**
- Modify: `frontend/src/app/components/gear/topGearSelection.ts` (add the two helpers)
- Modify: `frontend/src/app/components/gear/TopGearItemSelector.tsx` (import instead of local definitions)

**Interfaces:**
- Produces (in `topGearSelection.ts`): `export function mergeAlternative(resolved, slot, alternative)` and `export function selectAlternative(selectedUids, slot, uid)` — bodies identical to the current file-local versions in `TopGearItemSelector.tsx` (lines 42–69).

- [ ] **Step 1: Move the two functions**

Cut `mergeAlternative` and `selectAlternative` from `TopGearItemSelector.tsx` into `topGearSelection.ts` (exported, reuse existing `cloneSelectedUids` for `selectAlternative`'s clone). In `TopGearItemSelector.tsx`, import them from `./topGearSelection` and delete the local copies.

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean. Manually confirm Top Gear catalyst/void-forge/upgrade still add alternatives (they use these helpers).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/gear/topGearSelection.ts frontend/src/app/components/gear/TopGearItemSelector.tsx
git commit -m "refactor(top-gear): share mergeAlternative/selectAlternative helpers"
```

---

### Task 7: AddItemModal

**Files:**
- Create: `frontend/src/app/components/gear/AddItemModal.tsx`

**Interfaces:**
- Consumes: `<LootBrowser>` (Task 4), `buildItemLevelOptions`/`dropPayloadAtIlvl` (Task 5), `postJson` (`lib/api`), `ResolvedItem` type.
- Produces:

```typescript
export interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  simcInput: string;
  /** Called with the backend-resolved items to merge into Top Gear state. */
  onItemsResolved: (items: ResolvedItem[]) => void;
}
```

- [ ] **Step 1: Implement the modal**

Build a modal shell (match an existing modal/overlay in the codebase for styling — search `components/ui` for a Modal/Dialog; if none, a fixed full-screen overlay `div` with the standard `card` panel). Contents:
- a per-item ilvl selection state: `const [ilvlByUid, setIlvlByUid] = useState<Record<string, number>>({})` keyed by `dropUid(item)`;
- render `<LootBrowser hideDifficultyControls renderLevel={(item) => <IlvlSelect .../>} footer={...} />`;
- `renderLevel={(item, tracks) => <IlvlSelect ... />}` builds options via `buildItemLevelOptions(item, tracks)` and renders a `<select>`; default selected value = first option (max). Selecting updates `ilvlByUid`. (`tracks` arrives as the 2nd arg per the Task 3/4 signature — no further wiring needed.)
- footer "Add" button: for each selected drop, look up its chosen `IlvlOption` (by `ilvlByUid[dropUid]`, defaulting to the max option), build `dropPayloadAtIlvl`, collect into `drop_items`, then:

```typescript
const res = await postJson<{ items: ResolvedItem[] }>('/api/top-gear/resolve-drops', {
  simc_input: simcInput,
  drop_items: dropItems,
});
onItemsResolved(res.items);
onClose();
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean. (Full manual check happens in Task 8 once wired.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/gear/AddItemModal.tsx
git commit -m "feat(top-gear): AddItemModal with per-item ilvl selector"
```

---

### Task 8: Wire AddItemModal into TopGearScreen (merge, select, localItems, persist, remove)

**Files:**
- Modify: `frontend/src/app/top-gear/TopGearScreen.tsx`
- Modify: `frontend/src/app/components/gear/TopGearItemSelector.tsx` (remove affordance for loot-added items)
- Modify: `frontend/src/app/lib/topgear-state.ts` (persist resolved loot items)

**Interfaces:**
- Consumes: `AddItemModal`, `mergeAlternative`/`selectAlternative` (shared, Task 6), `toLocalItem`.

- [ ] **Step 1: Add the button + modal + merge handler in TopGearScreen**

Add state `const [addOpen, setAddOpen] = useState(false)` and an "Add item" button rendered near the gear selector (only when `resolved` is present). On resolve:

```tsx
<AddItemModal
  open={addOpen}
  onClose={() => setAddOpen(false)}
  simcInput={submitInput}
  onItemsResolved={(items) => {
    setResolved((prev) => {
      let next = prev;
      for (const item of items) next = mergeAlternative(next!, item.slot, item);
      return next;
    });
    setSelectedUids((prev) => {
      let next = prev;
      for (const item of items) next = selectAlternative(next, item.slot, item.uid);
      return next;
    });
    setLocalItems((prev) => [
      ...prev,
      ...items.map((i) => toLocalItem(i.slot, i.simc_string, 'loot')),
    ]);
  }}
/>
```

Dedup: before merging, skip an item whose `buildAlternativeKey` already exists in `resolved.slots[item.slot].alternatives` (import `buildAlternativeKey` from `topGearIdentity`).

- [ ] **Step 2: Persist resolved loot items across refresh**

`localItems` already persists, but the merged alternatives are display-only and lost on refresh. Add `addedLootItems: ResolvedItem[]` to `TopGearSavedState` in `topgear-state.ts`; store the merged loot items in TopGearScreen state and include them in `saveState`; on restore, re-merge them into `resolved` and re-select. (Mirror the existing `localItems` save/restore wiring in TopGearScreen lines ~427–440 and the restore path.)

- [ ] **Step 3: Removal affordance**

In `TopGearItemSelector`/`TopGearGroupCard`, show a small "×" on alternatives whose `origin === 'loot'` AND that are user-added (distinguish from parsed loot via the added set — pass an `addedUids: Set<string>` down, or gate on membership in `addedLootItems`). Clicking it: remove from `resolved` alternatives, from `selectedUids`, and the matching entry from `localItems`. Add an `onRemoveAdded(item)` callback through the selector props and implement the three-way removal in TopGearScreen.

- [ ] **Step 4: Verify (manual, end-to-end)**

Run: `cd frontend && npx tsc --noEmit && npm run lint`. Then run the app (`/run` or the project's dev command) and verify:
- "Add item" opens the modal with the full catalog + filters;
- picking an item at a chosen ilvl adds it as a selected alternative in the correct slot group (rings appear under Rings for both finger slots);
- a Void-Forged / Catalyst variant shows its badge and correct ilvl;
- combo count updates; submitting a Top Gear sim includes the added item;
- refresh restores the added item; the "×" removes it cleanly;
- adding the same item twice does not duplicate it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/top-gear/TopGearScreen.tsx frontend/src/app/components/gear/TopGearItemSelector.tsx frontend/src/app/components/gear/TopGearGroupCard.tsx frontend/src/app/lib/topgear-state.ts
git commit -m "feat(top-gear): add-item-from-catalog modal wired into Top Gear"
```

---

## Final verification

- [ ] `cd backend && cargo test -p simhammer-core` — all green (includes new resolve_drops tests).
- [ ] `cd backend && cargo build` — clean.
- [ ] `cd frontend && npx tsc --noEmit && npm run lint` — clean.
- [ ] Manual end-to-end per Task 8 Step 4, plus a full DropFinder regression pass (Task 4 Step 3).
