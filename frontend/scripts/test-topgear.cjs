const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  buildVisibleGroups,
  partitionByAlternatives,
  pickEquippedReplacements,
  unchangedSlotCount,
} = require('../src/app/components/gear/topGearSelection.ts');
const { gearGridColumns } = require('../src/app/components/gear/gearDensity.ts');

const group = (label, alternativeCount) => ({
  group: { label, slots: [label] },
  equipped: [{ uid: `${label}-eq` }],
  alternatives: Array.from({ length: alternativeCount }, (_, i) => ({ uid: `${label}-alt-${i}` })),
});

const labels = (groups) => groups.map((entry) => entry.group.label);

test('groups with alternatives become cards, groups without become unchanged', () => {
  const { cards, unchanged } = partitionByAlternatives(
    [group('slot.head', 2), group('slot.wrist', 0), group('slot.rings', 3)],
    new Set()
  );
  assert.deepEqual(labels(cards), ['slot.head', 'slot.rings']);
  assert.deepEqual(labels(unchanged), ['slot.wrist']);
});

test('a promoted group stays a card even with no alternatives', () => {
  const { cards, unchanged } = partitionByAlternatives(
    [group('slot.head', 0), group('slot.wrist', 0)],
    new Set(['slot.wrist'])
  );
  assert.deepEqual(labels(cards), ['slot.wrist']);
  assert.deepEqual(labels(unchanged), ['slot.head']);
});

test('promoting a group that already has alternatives does not duplicate it', () => {
  const { cards, unchanged } = partitionByAlternatives(
    [group('slot.head', 1)],
    new Set(['slot.head'])
  );
  assert.deepEqual(labels(cards), ['slot.head']);
  assert.deepEqual(unchanged, []);
});

test('input order is preserved in both lists', () => {
  const { cards, unchanged } = partitionByAlternatives(
    [group('a', 0), group('b', 1), group('c', 0), group('d', 1), group('e', 0)],
    new Set()
  );
  assert.deepEqual(labels(cards), ['b', 'd']);
  assert.deepEqual(labels(unchanged), ['a', 'c', 'e']);
});

test('empty input yields two empty lists', () => {
  const { cards, unchanged } = partitionByAlternatives([], new Set());
  assert.deepEqual(cards, []);
  assert.deepEqual(unchanged, []);
});

test('unchangedSlotCount counts equipped pieces, not groups', () => {
  // rings and trinkets are one group but two slots each
  const groups = [
    { group: { label: 'slot.head', slots: ['head'] }, equipped: [{ uid: 'h' }], alternatives: [] },
    {
      group: { label: 'slot.rings', slots: ['finger1', 'finger2'] },
      equipped: [{ uid: 'r1' }, { uid: 'r2' }],
      alternatives: [],
    },
    {
      group: { label: 'slot.trinkets', slots: ['trinket1', 'trinket2'] },
      equipped: [{ uid: 't1' }, { uid: 't2' }],
      alternatives: [],
    },
  ];
  assert.equal(groups.length, 3);
  assert.equal(unchangedSlotCount(groups), 5);
});

test('unchangedSlotCount is 0 for no groups', () => {
  assert.equal(unchangedSlotCount([]), 0);
});

const gear = (uid, slot, itemId) => ({
  uid,
  slot,
  item_id: itemId,
  ilevel: 300,
  bonus_ids: [],
  origin: 'bags',
  enchant_id: 0,
  gem_id: 0,
  simc_string: `,id=${itemId}`,
});
const resolvedGear = {
  slots: {
    head: {
      equipped: gear('h-eq', 'head', 1),
      alternatives: [gear('h-a', 'head', 2), gear('h-b', 'head', 3)],
    },
    finger1: {
      equipped: gear('r1-eq', 'finger1', 10),
      alternatives: [gear('ra1', 'finger1', 30), gear('rb1', 'finger1', 31)],
    },
    finger2: {
      equipped: gear('r2-eq', 'finger2', 11),
      alternatives: [gear('ra2', 'finger2', 30), gear('rb2', 'finger2', 31)],
    },
  },
};
const replacements = (excluded, selected) =>
  Object.fromEntries(
    Object.entries(
      pickEquippedReplacements(
        buildVisibleGroups(resolvedGear),
        new Set(excluded),
        resolvedGear,
        Object.fromEntries(Object.entries(selected).map(([slot, uids]) => [slot, new Set(uids)]))
      )
    ).map(([slot, item]) => [slot, item.uid])
  );

test('the first alternative ticked replaces an unticked equipped item', () => {
  assert.deepEqual(replacements(['head'], { head: ['h-b', 'h-a'] }), { head: 'h-b' });
});

test('deselecting the replacement hands the role to the next one ticked', () => {
  assert.deepEqual(replacements(['head'], { head: ['h-a'] }), { head: 'h-a' });
});

test('an unticked slot with nothing ticked gets no replacement', () => {
  assert.deepEqual(replacements(['head'], {}), {});
});

test('a replaced ring never duplicates the ring kept on the other finger', () => {
  assert.deepEqual(replacements(['finger1'], { finger1: ['ra1', 'rb1'] }), { finger1: 'ra1' });
});

test('replacing both rings takes the first two different rings ticked', () => {
  const picked = replacements(['finger1', 'finger2'], {
    finger1: ['rb1', 'ra1'],
    finger2: ['rb2', 'ra2'],
  });
  assert.deepEqual(picked, { finger1: 'rb1', finger2: 'ra2' });
});

test('with one ring ticked only one finger can be replaced', () => {
  const picked = replacements(['finger1', 'finger2'], { finger1: ['ra1'], finger2: ['ra2'] });
  assert.deepEqual(picked, { finger1: 'ra1' });
});

test('gearGridColumns clamps the track so it cannot outgrow its container', () => {
  // A bare minmax(300px, 1fr) cannot shrink below 300px and overflows a
  // narrower container; min(300px, 100%) can.
  assert.equal(gearGridColumns('compact'), 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))');
  assert.equal(gearGridColumns('ultra'), 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))');
  assert.equal(
    gearGridColumns('comfortable', true),
    'repeat(auto-fill, minmax(min(220px, 100%), 1fr))'
  );
});

test('every density has complete row metrics and layout entries', () => {
  const {
    GEAR_ROW_DENSITIES,
    GEAR_ROW_METRICS,
    GEAR_DENSITY_LAYOUT,
    gearCardClass,
  } = require('../src/app/components/gear/gearDensity.ts');
  for (const density of GEAR_ROW_DENSITIES) {
    for (const key of ['row', 'icon', 'name', 'details', 'box', 'check', 'button', 'ilevel']) {
      assert.ok(GEAR_ROW_METRICS[density][key], `${density}.${key} missing`);
    }
    for (const key of ['card', 'cardGap', 'title', 'rule', 'gap', 'minCol', 'gemMinCol']) {
      assert.ok(GEAR_DENSITY_LAYOUT[density][key], `${density}.${key} missing`);
    }
    assert.match(gearCardClass(density), /^card /);
  }
});

const { buildResolvedCopy } = require('../src/app/components/gear/topGearIdentity.ts');

test('buildResolvedCopy keeps the source segment on owned catalysed gear', () => {
  const owned = {
    uid: '250042::equipped:head:249629',
    item_id: 250042,
    bonus_ids: [],
    origin: 'equipped',
    slot: 'head',
    is_catalyst: false,
    source_item_id: 249629,
  };
  const copy = buildResolvedCopy(owned, { origin: 'bags' });
  assert.equal(copy.uid, '250042::bags:head:249629');
});

const { getWowheadData } = require('../src/app/lib/useItemInfo.ts');

test('getWowheadData emits original-item for owned catalysed gear without the conversion flag', () => {
  const params = new URLSearchParams(getWowheadData({ ilevel: 600, source_item_id: 249629 }));
  assert.equal(params.get('original-item'), '249629');
});

test('getWowheadData skips original-item on Void Forge rows, which reuse source_item_id', () => {
  const params = new URLSearchParams(
    getWowheadData({ ilevel: 600, source_item_id: 111, is_void_forge: true })
  );
  assert.equal(params.get('original-item'), null);
});

// ---- Source summary ----
const {
  summarizeByEncounter,
  expectedDelta,
  bestDelta,
  bestPerItem,
  collectItemQueries,
  collectGemIds,
  appliedGems,
  dedupeEncounterResults,
  buildBestGearSet,
} = require('../src/app/components/gear/topGearResultsUtils.ts');

let nextItemId = 1;
/** A result for a distinct item, unless `itemId` pins it to an existing one. */
const res = (encounter, delta, { precision, itemId, slot = 'head' } = {}) => {
  const id = itemId ?? nextItemId++;
  return {
    name: `${encounter}-${id}-${slot}`,
    dps: 100000 + delta,
    delta,
    items: [{ item_id: id, ilevel: 1, name: `Item ${id}`, slot, encounter }],
    ...(precision === undefined ? {} : { precision_pct: precision }),
  };
};

test('expected value averages a source upgrades, counting a downgrade as nothing', () => {
  // Nobody is forced to equip a downgrade, so it contributes 0 rather than
  // dragging the average below what the source is actually worth.
  const group = [res('Boss', 300), res('Boss', 100), res('Boss', -800)];
  assert.equal(expectedDelta(group), (300 + 100 + 0) / 3);
  assert.equal(bestDelta(group), 300);
  assert.equal(expectedDelta([]), 0);
  assert.equal(bestDelta([]), 0);
});

test('an item simmed in two slots counts once, at the slot worth equipping', () => {
  // A ring is simmed in finger1 and finger2. Only one of those is ever worn, so
  // the worse slot must not register as a second, negative outcome.
  const ring = nextItemId++;
  const group = [
    res('Boss', 900, { itemId: ring, slot: 'finger1' }),
    res('Boss', -600, { itemId: ring, slot: 'finger2' }),
    res('Boss', 300),
  ];
  const collapsed = bestPerItem(group);
  assert.deepEqual(
    collapsed.map((result) => result.delta),
    [900, 300]
  );
  const [row] = summarizeByEncounter(group, 'expected', 100000);
  assert.equal(row.results.length, 2, 'the strip shows items, not slot rows');
  assert.equal(row.expected, (900 + 300) / 2, 'the worse slot is not averaged in');
  assert.equal(row.best, 900);
});

test('a catalyst or Void Forge variant stays its own item', () => {
  // Two sources convert to the same tier piece; each sims different secondaries,
  // so they are genuinely different outcomes rather than one item in two slots.
  const tier = nextItemId++;
  const group = [
    {
      ...res('Boss', 500, { itemId: tier }),
      items: [
        {
          item_id: tier,
          ilevel: 1,
          name: 'T',
          slot: 'head',
          encounter: 'Boss',
          source_item_id: 11,
        },
      ],
    },
    {
      ...res('Boss', 200, { itemId: tier }),
      items: [
        {
          item_id: tier,
          ilevel: 1,
          name: 'T',
          slot: 'head',
          encounter: 'Boss',
          source_item_id: 22,
        },
      ],
    },
  ];
  assert.equal(bestPerItem(group).length, 2);
});

test('a Void Forged row does not queue a second, bonus-less lookup of itself', () => {
  // Void Forge points source_item_id at its own id, and the batch response is
  // keyed by item id alone — so a bare duplicate can overwrite the forged
  // entry's info with the base item's.
  const forged = res('Boss', 500);
  const id = forged.items[0].item_id;
  forged.items[0].bonus_ids = [123];
  forged.items[0].source_item_id = id;
  forged.items[0].is_void_forge = true;
  const queries = collectItemQueries([forged]);
  assert.equal(queries.length, 1, `expected one query, got ${JSON.stringify(queries)}`);
});

test('the item lookup covers the drop a catalyst row converts', () => {
  // The CAT pill names where the conversion came from, so the source item's
  // info has to be fetched even though no row is simmed under that id.
  const conversion = res('Boss', 500);
  conversion.items[0].is_catalyst = true;
  conversion.items[0].source_item_id = 90210;
  const ids = collectItemQueries([conversion]).map((query) => query.item_id);
  assert.ok(ids.includes(90210), `source item missing from ${JSON.stringify(ids)}`);
});

test('a drop draws a chip per socket, skipping gems whose info has not arrived', () => {
  const gems = {
    11: { gem_id: 11, name: 'Garnet', icon: 'a', quality: 4 },
    22: { gem_id: 22, name: 'Lapis', icon: 'b', quality: 4 },
  };
  const ids = (item) => appliedGems(item, gems).map((gem) => gem.gem_id);
  assert.deepEqual(ids({ gem_id: 11, gem_ids: [11, 22] }), [11, 22]);
  // `gem_ids` is absent on older results, so the single id still has to draw.
  assert.deepEqual(ids({ gem_id: 11 }), [11]);
  assert.deepEqual(ids({ gem_ids: [99] }), []);
});

test('two combos that move different gear stay two rows', () => {
  // The swapped trinket pair puts the drop in the partner's slot AND moves the
  // partner into the drop's — a different gear set from simply dropping into
  // that slot, even though the drop itself lands identically.
  const plain = res('Boss', 900, { itemId: 500, slot: 'trinket2' });
  const swapped = res('Boss', 400, { itemId: 500, slot: 'trinket2' });
  swapped.items.push({
    item_id: 777,
    ilevel: 1,
    name: 'Partner',
    slot: 'trinket1',
    encounter: 'Boss',
    is_kept: true,
  });
  const rows = dedupeEncounterResults([plain, swapped], true);
  assert.equal(rows.length, 2, 'the swap must not collapse into the plain combo');
});

test('the gem lookup covers every socket on a drop, not just the first', () => {
  // A neck or crafted piece carries more than one gem, and the row draws a chip
  // per socket — an unfetched gem id would drop its chip silently.
  const drop = res('Boss', 100);
  drop.items[0].gem_id = 11;
  drop.items[0].gem_ids = [11, 22];
  assert.deepEqual(collectGemIds([drop]).sort(), [11, 22]);
});

test('expected value folds a catalyst conversion onto the drop it converts', () => {
  // Catalysing the head you just looted is what you do WITH that drop, not a
  // second chance at one, so the pair counts once at the better of the two.
  const source = nextItemId++;
  const conversion = res('Boss', 3306, { itemId: nextItemId++ });
  conversion.items[0].source_item_id = source;
  const group = [
    res('Boss', 3237, { itemId: source }),
    conversion,
    res('Boss', 1905),
    res('Boss', 1196),
  ];
  assert.equal(expectedDelta(bestPerItem(group)), (3306 + 1905 + 1196) / 3);
});

test('expected value folds a Void Forged copy onto the drop it upgrades', () => {
  // The forged copy is the same drop rolling higher, so it replaces its base in
  // the average rather than adding an outcome the boss cannot separately give.
  const base = nextItemId++;
  const forged = res('Boss', 900, { itemId: base });
  forged.items[0].ilevel = 2;
  forged.items[0].source_item_id = base;
  const group = [res('Boss', 500, { itemId: base }), forged, res('Boss', 200)];
  assert.equal(expectedDelta(bestPerItem(group)), (900 + 200) / 2);
});

test('an encounter row carries every combination simmed for it, best first', () => {
  // The collapsed strip shows items; expanding the row shows the sims, so both
  // slot rows of a ring have to survive alongside the other drops.
  const ring = nextItemId++;
  const group = [
    res('Boss', 100),
    res('Boss', 900, { itemId: ring, slot: 'finger1' }),
    res('Boss', -600, { itemId: ring, slot: 'finger2' }),
  ];
  const [row] = summarizeByEncounter(group, 'expected', 100000);
  assert.deepEqual(
    row.combos.map((result) => result.delta),
    [900, 100, -600]
  );
  assert.equal(row.results.length, 2, 'the strip still collapses the ring to one item');
});

test('an encounter row names the instance its drops come from', () => {
  const drop = res('Boss', 100);
  drop.items[0].instance = 'The Venomous Abyss';
  const [row] = summarizeByEncounter([drop], 'expected', 100000);
  assert.equal(row.instance, 'The Venomous Abyss');
});

test('a chain of near-ties does not drag distant sources into one priority', () => {
  // Each neighbour is within the band, but the ends are not: 300 vs 150 is
  // 150 DPS apart against a 100 DPS band, which the sim can plainly separate.
  const results = [
    res('Top', 300, { precision: 0.1 }),
    res('Middle', 225, { precision: 0.1 }),
    res('Bottom', 150, { precision: 0.1 }),
  ];
  const rows = summarizeByEncounter(results, 'expected', 100000);
  assert.deepEqual(
    rows.map((row) => row.priority),
    [1, 1, 2]
  );
});

test('sorting by expected value can outrank a source with the single best drop', () => {
  // Thin has one huge item and three duds; Broad is good across the board.
  const results = [
    res('Thin', 1000),
    res('Thin', 0),
    res('Thin', 0),
    res('Thin', 0),
    res('Broad', 400),
    res('Broad', 400),
    res('Broad', 400),
    res('Broad', 400),
  ];
  const byExpected = summarizeByEncounter(results, 'expected', 100000);
  assert.deepEqual(
    byExpected.map((row) => row.encounter),
    ['Broad', 'Thin']
  );
  assert.equal(byExpected[0].expected, 400);
  assert.equal(byExpected[1].expected, 250);
  const byBest = summarizeByEncounter(results, 'best', 100000);
  assert.deepEqual(
    byBest.map((row) => row.encounter),
    ['Thin', 'Broad']
  );
});

test('sources the sim cannot tell apart share a priority', () => {
  // 1% precision on a 100k baseline is a 1000 DPS band: 900 apart is noise,
  // 2000 apart is real.
  const results = [
    res('A', 5000, { precision: 1 }),
    res('B', 4100, { precision: 1 }),
    res('C', 2100, { precision: 1 }),
  ];
  const rows = summarizeByEncounter(results, 'expected', 100000);
  assert.deepEqual(
    rows.map((row) => [row.encounter, row.priority]),
    [
      ['A', 1],
      ['B', 1],
      ['C', 2],
    ]
  );
  // Without precision data there is no band, so every source stands alone.
  const exact = summarizeByEncounter(
    [res('A', 5000), res('B', 4100), res('C', 2100)],
    'expected',
    100000
  );
  assert.deepEqual(
    exact.map((row) => row.priority),
    [1, 2, 3]
  );
});

test('results without an encounter are left out of the summary', () => {
  const stray = res('', 500);
  stray.items = [{ item_id: 9999, ilevel: 1, name: 'y', slot: 'neck' }];
  const rows = summarizeByEncounter([res('Boss', 100), stray], 'expected', 100000);
  assert.deepEqual(
    rows.map((row) => row.encounter),
    ['Boss']
  );
});

// A worn stat-less trinket is absent from `equipped_gear` — see buildBestGearSet.
const keptSigil = { slot: 'trinket2', item_id: 250224, ilevel: 675, name: 'sigil', is_kept: true };

test('a kept item missing from the gear report falls back to its combo row', () => {
  const equipped = { trinket1: { slot: 'trinket1', item_id: 111, ilevel: 675, name: 'flask' } };
  const gearSet = buildBestGearSet(equipped, { items: [keptSigil] });
  assert.equal(gearSet.trinket2?.item_id, 250224);
  assert.equal(gearSet.trinket1?.item_id, 111);
});

test('the gear report still wins for a slot it does report', () => {
  const equipped = { trinket2: { slot: 'trinket2', item_id: 222, ilevel: 680, name: 'reported' } };
  const gearSet = buildBestGearSet(equipped, { items: [keptSigil] });
  assert.equal(gearSet.trinket2.item_id, 222);
});

test('a swapped item outranks the kept fallback for the same slot', () => {
  const swapped = { slot: 'trinket2', item_id: 333, ilevel: 690, name: 'drop' };
  const gearSet = buildBestGearSet({}, { items: [keptSigil, swapped] });
  assert.equal(gearSet.trinket2.item_id, 333);
  // Order must not matter: the kept row only ever fills a hole.
  const reversed = buildBestGearSet({}, { items: [swapped, keptSigil] });
  assert.equal(reversed.trinket2.item_id, 333);
});

test('the fallback never resurrects the off_hand a two-hander empties', () => {
  const keptOffHand = {
    slot: 'off_hand',
    item_id: 444,
    ilevel: 675,
    name: 'shield',
    is_kept: true,
  };
  const synthetic = { slot: 'off_hand', item_id: 0, ilevel: 0, name: '', origin: 'system' };
  const gearSet = buildBestGearSet({}, { items: [keptOffHand, synthetic] });
  assert.equal(gearSet.off_hand, undefined);
});

test('gem and enchant rows are not mistaken for kept gear', () => {
  const gem = { slot: 'trinket2', type: 'gem', gem_id: 5, item_id: 250224, is_kept: true };
  const gearSet = buildBestGearSet({}, { items: [gem] });
  assert.equal(gearSet.trinket2, undefined);
});

const {
  consumableMixCount,
  effectiveConsumableOptions,
} = require('../src/app/lib/consumableOptions.ts');

test('consumable alternatives drop whatever the baseline already uses', () => {
  const options = { flask: ['flask_a_2', 'flask_b_2'], food: ['food_a'], potion: [] };
  // The baseline flask in another quality is still the same flask.
  const effective = effectiveConsumableOptions(options, { flask: 'flask_a_1' });
  assert.deepEqual(effective, { flask: ['flask_b_2'], food: ['food_a'] });
});

test('consumable mixes multiply across slots, baseline included', () => {
  assert.equal(consumableMixCount({}), 1);
  assert.equal(consumableMixCount({ flask: ['a', 'b'], food: ['c'] }), 6);
});

test('character media URLs use the Blizzard realm slug from the SimC server= value', () => {
  const {
    getCharacterRenderUrl: renderUrl,
  } = require('../src/app/components/gear/topGearResultsUtils.ts');
  const base = 'https://simhammer.com/api/blizzard/character/eu';
  assert.equal(renderUrl('grim_batol', 'Klysus', 'eu'), `${base}/grim-batol/klysus/media/render`);
  assert.equal(renderUrl("Mal'Ganis", 'Name', 'eu'), `${base}/malganis/name/media/render`);
  assert.equal(renderUrl('Argent Dawn', 'Name', 'eu'), `${base}/argent-dawn/name/media/render`);
});

test('a compacted SimC realm resolves to its Blizzard slug through the realm list', () => {
  const { resolveRealmSlug } = require('../src/app/lib/realms.ts');
  const { regions } = require('../src/app/lib/realms.json');
  assert.equal(resolveRealmSlug('twistingnether', regions), 'twisting-nether');
  assert.equal(resolveRealmSlug('grim_batol', regions), 'grim-batol');
  assert.equal(resolveRealmSlug('Draenor', regions), 'draenor');
  // Unknown realms fall back to the plain conversion rather than vanishing.
  assert.equal(resolveRealmSlug('Made_Up', regions), 'made-up');
});

test('trimmed render headers parse into bounds, and the body centre stays centred', () => {
  const {
    parseRenderBounds,
    renderCentreShift,
  } = require('../src/app/components/gear/useTrimmedRender.ts');
  const r = parseRenderBounds('363,400,572,574', '1600,1200');
  assert.deepEqual(r, { x: 363, y: 400, width: 572, height: 574, canvasWidth: 1600 });
  assert.equal(parseRenderBounds(null, '1600,1200'), null);
  assert.equal(parseRenderBounds('1,2,3', '1600,1200'), null);
  assert.equal(parseRenderBounds('0,0,0,10', '1600,1200'), null);
  // Klysus: canvas centre (800) sits 437px into a 572px-wide crop, so shift left by 76.4%.
  assert.equal(renderCentreShift(r).toFixed(1), '76.4');
  // A crop centred on the canvas shifts by exactly half its width.
  assert.equal(renderCentreShift({ x: 700, y: 0, width: 200, height: 400, canvasWidth: 1600 }), 50);
});
