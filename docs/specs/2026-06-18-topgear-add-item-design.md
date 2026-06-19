# Top Gear — "Add Item" from the loot catalog

**Date:** 2026-06-18
**Status:** Design (approved decisions, pending spec review)

## Problem

Top Gear can only reason about gear the user already owns — items resolved from
their addon export / armory import (equipped, bags, vault, loot). There is no way
to throw an *aspirational* item ("what if I had this trinket from the new raid?")
into the comparison.

We want an **"Add item"** button in Top Gear that opens a modal letting users
browse the full loot catalog (the same data DropFinder shows) and add any item as
a candidate for the optimization.

## Goal & success criteria

- A user can open a modal from Top Gear, browse the full DropFinder catalog
  (category tabs, instance/spec/slot filters, search), pick an item at a chosen
  item level, and add it.
- The added item appears as an **auto-selected alternative in its slot group**,
  identical in appearance and behaviour to parsed gear (correct sockets, upgrade
  label, variant badges).
- The added item participates in combination generation and survives a page
  refresh.
- Added items can be removed again.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Item behaviour | New, auto-selected **alternative** in the slot group; joins the combo engine. Reuses the existing `localItems` + `mergeAlternative` pattern. |
| Item level choice | A **single item-level dropdown per item**, inline on each browser row. User picks an ilvl; we derive the matching `bonus_id` behind the scenes (no separate difficulty/upgrade controls). |
| Catalog | Reuse the **full DropFinder browser**, extracted into a shared `<LootBrowser>` component. |
| DropItem → ResolvedItem | **Backend resolve endpoint** (`POST /api/top-gear/resolve-drops`) that runs the existing `gear_resolver` for authoritative enrichment. |
| Rings / trinkets | An added ring/trinket becomes an alternative in **both** sub-slots (`finger1`+`finger2`, `trinket1`+`trinket2`). |
| Origin tag | Added items get `origin: 'loot'` so they fold into the existing "Loot" quick-select and read as loot visually. |

## Why a backend endpoint (Approach A)

The actual simulation already re-resolves added items server-side: `localItems`
are appended to the simc input as `# slot=simc_string` lines and parsed +
gear-resolved at sim time. So sim correctness is never in question.

What the endpoint buys us is an **authoritative preview**: a `DropItem` lacks the
socket count and upgrade-track label needed to render a faithful alternative row,
and the gem-all-sockets feature depends on an accurate socket count. Rebuilding
that enrichment (sockets, upgrade labels, void-forge/catalyst variants) in
TypeScript would duplicate the Rust `gear_resolver` and risk drift. Routing the
preview through the same resolver guarantees added items look and behave exactly
like parsed gear.

The droptimizer handler is *not* a reuse target: it calls
`profileset_generator::generate_droptimizer_input` directly and never produces
`ResolvedItem`s for display.

## Architecture

### Components

```
TopGearScreen
  └─ AddItemButton ──opens──> AddItemModal
                                 └─ <LootBrowser mode="add-to-topgear">
                                      └─ ItemTable rows + inline ilvl dropdown
                                 └─ "Add" action → POST /api/top-gear/resolve-drops
DropFinderContent (thin wrapper)
  └─ <LootBrowser mode="droptimizer"> + existing droptimizer submit
```

**`<LootBrowser>` (new, extracted from `DropFinderContent.tsx`)**
- Owns: category tabs, instance multi-select drawer, spec/slot filters, search,
  the items map (`Record<slot, DropItem[]>`), selection set, and the
  `UpgradeTracks` data it already fetches.
- Props: `simcInput` (for class/spec detection), `mode: 'droptimizer' | 'add-to-topgear'`,
  and an optional `renderRowControl(item) => ReactNode` render-prop so a host can
  inject per-row controls (Top Gear's inline ilvl dropdown).
- Output: a confirm callback carrying the selected items; the host decides what to
  do with them. DropFinder keeps its difficulty/upgrade controls and droptimizer
  submit; the Top Gear modal supplies the ilvl dropdown + "Add" handler.

`DropFinderContent` becomes a thin wrapper around `<LootBrowser>` + its existing
submit. This extraction is in-scope: the file is 887 lines and currently couples
browsing with droptimizer submission; splitting the browser out is the minimal
change that serves the goal and shrinks DropFinder.

**`AddItemModal.tsx` (new, Top Gear)**
- Modal shell around `<LootBrowser mode="add-to-topgear">`.
- Tracks a per-item chosen ilvl (`Record<dropUid, number>`), defaulting to the
  item's max achievable ilvl.
- Renders the inline ilvl dropdown via `renderRowControl`.
- On "Add": builds `DropItemPayload[]`, calls the resolve endpoint, and hands the
  returned `ResolvedItem[]` back to `TopGearScreen`.

**`AddItemButton` / trigger** in `TopGearScreen` near the existing gear controls.

### Item-level options (frontend)

For a `DropItem`, enumerate candidate ilvls from `difficulty_info` and
`dungeon_info`: each base `TrackInfo` gives `(ilvl, bonus_id, track)`; expand via
`UpgradeTracks[track]` to every track level → `(ilvl, bonus_id)`. Dedup by ilvl,
sort descending, default to the max. The chosen option carries the `bonus_id` to
apply — this replaces `resolveUpgrade(raidDiff, dungeonDiff, level)` with a direct
ilvl → bonus_id lookup.

The resulting `DropItemPayload` composes `bonus_ids` the same way
`DropFinderContent.buildPayload` does today (base `bonus_ids` + chosen track
`bonus_id` + `extra_bonus_ids`), so the backend receives the identical shape it
already accepts.

## Data flow

```
[Add item] → AddItemModal opens
  └─ browse + tick items, pick ilvl per row (inline dropdown)
  └─ "Add" → per item: ilvl → bonus_id lookup → DropItemPayload[]
       └─ POST /api/top-gear/resolve-drops { simc_input, drops }
            └─ backend: build loot RawParsedItems, run gear_resolver
            └─ response: { items: ResolvedItem[] }   (1 per drop × target slot)
  └─ frontend, per returned ResolvedItem:
       • mergeAlternative(resolved, slot, item)      → shows in slot group
       • selectAlternative(selectedUids, slot, uid)  → auto-selected
       • localItems += toLocalItem(slot, simc_string, 'loot')  → in submit payload
```

## Backend endpoint

```
POST /api/top-gear/resolve-drops
Request:  { simc_input: String, drops: Vec<DropItemPayload> }
Response: { items: Vec<ResolvedItem> }
```

Handler:
1. Parse `simc_input` (reuse `addon_parser::parse_simc_input`) to get the base
   profile / equipped context the resolver needs.
2. For each drop, build a loot-origin `RawParsedItem` (target slot from the drop's
   slot / `inventory_type`; `bonus_ids` already resolved by the frontend).
3. Run `gear_resolver::resolve_gear` (with catalyst/void-forge handling matching
   the existing path) over base + the new loot items.
4. Return the resolved loot alternatives matching the added drops.

**Ring/trinket duplication:** a finger/trinket drop must yield alternatives for
both sub-slots. Verify whether `resolve_gear` already fans loot rings/trinkets
across `finger1`/`finger2` (and `trinket1`/`trinket2`); if not, the handler
duplicates the `RawParsedItem` across both sub-slots before resolving.

## Edge cases

- **Duplicates:** if an identical alternative already exists (same
  `buildAlternativeKey`), do not add it again — mirror the dedup in
  `buildVisibleGroups`.
- **Removal:** added loot items need a remove affordance (small "×" on the row)
  that reverts `localItems` + the merged alternative + its selection. If no
  removal exists for the current bags-`localItems`, add it here.
- **Persistence:** `localItems` already lives in the sessionStorage Top Gear
  state, so added items survive refresh. To restore the merged alternatives
  without a network round-trip, **persist the resolved loot items alongside
  `localItems`** in the session state and re-merge them on load.
- **Unique-equipped / item limits:** enforced server-side at sim time via the
  shared gear-set validator; the modal does not duplicate this.

## Testing

**Backend**
- `resolve-drops`: a drop → correct `ResolvedItem` (ilvl, bonus_ids, sockets,
  upgrade label).
- A ring drop → two alternatives (`finger1` + `finger2`); same for trinkets.
- Void-forge / catalyst variant drops resolve with the right flags.

**Frontend**
- After "Add", the alternative appears in the correct slot group, is
  auto-selected, and is present in `localItems`.
- ilvl dropdown options derive correctly from `difficulty_info`/`dungeon_info` +
  tracks; default is max ilvl; chosen ilvl maps to the right `bonus_id`.
- Adding a duplicate is deduped; removing reverts all three pieces of state.
- `<LootBrowser>` extraction is behaviour-preserving for DropFinder (its existing
  tests stay green).

**Regression**
- Existing Top Gear generation tests (eager + iterator equivalence) stay green.

## Out of scope

- Bulk "add a whole raid's worth of items" presets.
- Persisting added items beyond the session.
- Changing how the sim itself resolves/validates gear (unchanged).
```
