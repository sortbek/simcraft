const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  partitionByAlternatives,
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

test('gearGridColumns clamps the track so it cannot outgrow its container', () => {
  // A bare minmax(300px, 1fr) cannot shrink below 300px and overflows a
  // narrower container; min(300px, 100%) can.
  assert.equal(
    gearGridColumns('compact'),
    'repeat(auto-fill, minmax(min(300px, 100%), 1fr))'
  );
  assert.equal(
    gearGridColumns('ultra'),
    'repeat(auto-fill, minmax(min(260px, 100%), 1fr))'
  );
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
