const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  lootSelectionReducer: reduce,
  initialLootSelection: initial,
  visibleIds,
} = require('../src/app/components/loot/lootSelection.ts');
const {
  embellishmentCapReached,
} = require('../src/app/components/loot/lootTableModel.ts');
const {
  categoryMayUsePreferredStats,
} = require('../src/app/components/loot/lootConfiguration.ts');
const {
  resolveDropConfiguration: resolve,
  dropPayload,
  dropWowheadAttr,
} = require('../src/app/components/loot/dropConfiguration.ts');
const {
  CLASS_SPEC_DATA,
  CLASS_SPECS,
  SPEC_ID_TO_NAME,
} = require('../src/app/lib/classSpecs.ts');
const item = (id, extra = {}) => ({
  item_id: id,
  name: 'Item',
  icon: '',
  ilevel: 100,
  quality: 4,
  encounter: '',
  ...extra,
});
const drops = { Head: [item(1)], Finger: [item(2), item(2, { is_void_forge: true })] };
const { dropUid } = require('../src/app/components/loot/dropUtils.ts');
const sync = (state, source = drops, filtered = source, datasetId = 'dataset') =>
  reduce(state, {
    type: 'reconcile',
    datasetId,
    availableBySlot: Object.fromEntries(
      Object.entries(filtered ?? {}).map(([slot, items]) => [slot, items.map(dropUid)])
    ),
  });
const ids = (state) => [...state.selected].sort();

test('new data selects visible items and keeps variants distinct', () => {
  assert.deepEqual(ids(sync(initial)), ['1', '2', '2:vf']);
  const filtered = { Head: drops.Head };
  assert.deepEqual(ids(sync(initial, drops, filtered)), ['1']);
});
test('pool or difficulty filtering removes items without restoring manual selections', () => {
  let state = reduce(sync(initial), { type: 'clear', uids: ['1'] });
  state = sync(state, drops, { Head: drops.Head, Finger: [drops.Finger[0]] });
  assert.deepEqual(ids(state), ['2']);
  state = sync(state, drops, drops);
  assert.deepEqual(ids(state), ['2']);
});
test('hiding and re-enabling a slot restores that slot while preserving other choices', () => {
  let state = reduce(sync(initial), { type: 'clear', uids: ['1', '2'] });
  state = reduce(state, { type: 'toggleSlot', slot: 'Finger' });
  assert.deepEqual(ids(state), []);
  assert.deepEqual([...visibleIds(state.availableBySlot, state.excludedSlots)], ['1']);
  state = reduce(state, { type: 'toggleSlot', slot: 'Finger' });
  assert.deepEqual(ids(state), ['2', '2:vf']);
});
test('refreshing data honors hidden slots and resetting slots restores their items', () => {
  let state = reduce(sync(initial), { type: 'toggleSlot', slot: 'Head' });
  state = sync(state, { ...drops }, drops, 'refreshed-dataset');
  assert.deepEqual(ids(state), ['2', '2:vf']);
  state = reduce(state, { type: 'resetSlots' });
  assert.deepEqual(ids(state), ['1', '2', '2:vf']);
  assert.equal(state.excludedSlots.size, 0);
  assert.deepEqual(ids(sync(state, null)), []);
});
test('selection actions cannot retain unavailable IDs and do not mutate previous state', () => {
  const state = sync(initial);
  const next = reduce(state, { type: 'toggle', uid: '1' });
  assert.deepEqual(ids(state), ['1', '2', '2:vf']);
  assert.deepEqual(ids(next), ['2', '2:vf']);
  assert.deepEqual(ids(reduce(next, { type: 'select', uids: ['1', 'missing'] })), [
    '1',
    '2',
    '2:vf',
  ]);
});
const options = {
  difficulty: 'heroic',
  dungeonDiff: 'mythic+10',
  upgradeLevel: 2,
  upgradeTracks: { Hero: [{ level: 2, max_level: 6, ilvl: 110, bonus_id: 9002, quality: 4 }] },
  preferredStats: [36, 49],
};
const flexible = item(271638, {
  accepts_preferred_stats: true,
  difficulty_info: { heroic: { ilvl: 100, bonus_id: 9001, quality: 4, track: 'Hero' } },
  extra_bonus_ids: [13575, 9002],
});
test('tooltip and payload agree on upgrades and variant bonuses', () => {
  const config = resolve(flexible, options);
  const payload = dropPayload(flexible, config);
  assert.equal(payload.ilevel, 110);
  assert.deepEqual(payload.bonus_ids, [9002, 13575]);
  const tooltip = new URLSearchParams(dropWowheadAttr(flexible, config));
  assert.equal(tooltip.get('bonus'), payload.bonus_ids.join(':'));
  assert.equal(tooltip.get('ilvl'), String(payload.ilevel));
  assert.equal(tooltip.get('crafted-stats'), '36:49');
  assert.equal('preferredStats' in payload, false);
});
test('fixed-stat items ignore preferences and unknown upgrades fall back to base', () => {
  const fixed = { ...flexible, accepts_preferred_stats: false };
  const config = resolve(fixed, { ...options, upgradeLevel: 99 });
  assert.equal(config.ilevel, 100);
  assert.equal(config.preferredStats, undefined);
  assert.equal(new URLSearchParams(dropWowheadAttr(fixed, config)).has('crafted-stats'), false);
});
test('tooltip retains catalyst source, inheritance and embellishments', () => {
  const catalyst = { ...flexible, is_catalyst: true, source_item_id: 123 };
  const tooltip = new URLSearchParams(
    dropWowheadAttr(catalyst, resolve(catalyst, options), { enchant_id: 42, gem_id: 43 }, [44])
  );
  assert.equal(tooltip.get('original-item'), '123');
  assert.equal(tooltip.get('ench'), '42');
  assert.equal(tooltip.get('gems'), '43');
  assert.equal(tooltip.get('bonus'), '9002:13575:44');
});
test('canonical spec data round-trips IDs and disambiguates shared names', () => {
  for (const [cls, specs] of Object.entries(CLASS_SPEC_DATA)) {
    assert.deepEqual(
      CLASS_SPECS[cls],
      specs.map((spec) => spec.name)
    );
    for (const spec of specs) {
      assert.equal(SPEC_ID_TO_NAME[spec.id], spec.name);
    }
  }
  // Ambiguous names must stay distinct per class, and Devourer must be present.
  assert.equal(SPEC_ID_TO_NAME[64], 'frost');
  assert.equal(SPEC_ID_TO_NAME[251], 'frost');
  assert.equal(SPEC_ID_TO_NAME[1480], 'devourer');
  assert.deepEqual(
    CLASS_SPEC_DATA['demon_hunter'].map((spec) => spec.id),
    [577, 581, 1480]
  );
});

const { buildLootItemRow: prepareRow } = require('../src/app/components/loot/lootItemRowModel.ts');
const buildLootItemRow = (item, slot, context) =>
  prepareRow(item, slot, { ...context, configuration: resolve(item, context.configuration) });
const rowContext = {
  configuration: options,
  equippedGear: { neck: { enchant_id: 42, gem_id: 43 } },
  spec: 'frost',
  locale: 'en_US',
  selected: new Set(),
};
test('row model prepares upgraded tooltip, inheritance, source and variant identity', () => {
  const drop = {
    ...flexible,
    inventory_type: 2,
    instance_name: 'Raid',
    encounter: 'Boss',
    is_void_forge: true,
  };
  const row = buildLootItemRow(drop, 'Neck', rowContext);
  assert.equal(row.uid, '271638:vf');
  assert.equal(row.slot, 'Neck');
  assert.equal(row.ilevel, 110);
  assert.equal(row.source, 'Raid • Boss');
  assert.equal(row.variants.is_void_forge, true);
  const tooltip = new URLSearchParams(row.tooltip);
  assert.equal(tooltip.get('crafted-stats'), '36:49');
  assert.equal(tooltip.get('ench'), '42');
  assert.equal(tooltip.get('gems'), '43');
  assert.equal(row.embellishment, undefined);
});
test('alternative embellished candidates are selectable independently', () => {
  const row = buildLootItemRow(
    item(3, { embellished: true, off_spec: true }),
    'Finger',
    rowContext
  );
  assert.equal(row.embellished, true);
  assert.equal(row.offSpec, true);
  assert.equal('disabled' in row, false);
});
test('row model filters embellishments and carries the selected bonus into its tooltip', () => {
  const matching = { id: 7, name: 'Effect', bonus_ids: [44], item_ids: [271638] };
  const context = {
    ...rowContext,
    embellishmentOptions: [matching, { id: 8, name: 'Other', bonus_ids: [45], item_ids: [99] }],
    embellishmentPicks: { 271638: 7 },
  };
  const row = buildLootItemRow(flexible, 'Neck', context);
  assert.deepEqual(row.embellishment, { value: 7, options: [matching] });
  assert.equal(new URLSearchParams(row.tooltip).get('bonus'), '9002:13575:44');
  const other = buildLootItemRow(item(5), 'Head', context);
  assert.equal(other.embellishment, undefined);
  assert.equal(new URLSearchParams(other.tooltip).has('crafted-stats'), false);
});

test('embellishment cap counts equipped pieces plus drops picked in this run', () => {
  // The case the equipped-only count missed: wear 1, select 2.
  assert.equal(embellishmentCapReached(1, 2), true);
  assert.equal(embellishmentCapReached(0, 2), true);
  assert.equal(embellishmentCapReached(2, 0), true);
  assert.equal(embellishmentCapReached(1, 0), false);
  assert.equal(embellishmentCapReached(0, 1), false);
  assert.equal(embellishmentCapReached(0, 0), false);
});

test('preferred-stats categories cover every pool holding flexible-stat gear', () => {
  // Raids plus all three profession pools; a raid+crafted whitelist missed the
  // Rare (-89) and PVP (-90) profession pools entirely.
  for (const category of ['raids', 'crafted', 'rare-profession', 'pvp-profession'])
    assert.equal(categoryMayUsePreferredStats(category), true, category);
  for (const category of ['mplus', 'normal-dungeons', 'delves', 'prey', 'catalyst', 'pvp-honor'])
    assert.equal(categoryMayUsePreferredStats(category), false, category);
});

test("variant tooltips: catalyst rows carry original-item, Void Forge rows do not", () => {
  const catalyst = item(250042, {
    ...flexible,
    item_id: 250042,
    is_catalyst: true,
    source_item_id: 271638,
  });
  const catalystTip = new URLSearchParams(
    dropWowheadAttr(catalyst, resolve(catalyst, options)),
  );
  assert.equal(catalystTip.get("original-item"), "271638");

  // Void Forge catalog rows reuse source_item_id for their own id.
  const voidForged = item(271638, {
    ...flexible,
    is_void_forge: true,
    source_item_id: 271638,
  });
  const vfTip = new URLSearchParams(
    dropWowheadAttr(voidForged, resolve(voidForged, options)),
  );
  assert.equal(vfTip.get("original-item"), null);
});
