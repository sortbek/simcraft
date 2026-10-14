require('./register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { blockedReason } = require('../src/app/components/forever/specs.ts');

test('below level 60 is blocked first', () => {
  assert.equal(blockedReason(27, 'retributionPaladin'), 'level');
  assert.equal(blockedReason(27, 'holyPaladin'), 'level');
});
test('a healer spec is blocked, a picked damage spec is not', () => {
  assert.equal(blockedReason(60, 'holyPaladin'), 'healer');
  assert.equal(blockedReason(60, null), 'healer');
  assert.equal(blockedReason(60, 'retributionPaladin'), null);
  assert.equal(blockedReason(60, 'dpsPriest'), null);
});

const { groupForTopGear } = require('../src/app/components/forever/topGearGroups.ts');
const gear = (slot, item_id, known = true) => ({
  slot,
  item_id,
  enchant_id: 0,
  name: `i${item_id}`,
  icon: '',
  quality: 2,
  ilevel: 10,
  known,
});

test('bag items group with the slot they fit; unknown bag items and slots without candidates drop out', () => {
  const groups = groupForTopGear(
    [gear('back', 1), gear('finger1', 2), gear('finger2', 3), gear('head', 4)],
    [gear('back', 10), gear('finger1', 11), gear('main_hand', 12, false)]
  );
  assert.deepEqual(
    groups.map(([key, g]) => [
      key,
      g.equipped.map((e) => e.item_id),
      g.bags.map((b) => [b.gear.item_id, b.index]),
    ]),
    [
      ['back', [1], [[10, 0]]],
      ['finger', [2, 3], [[11, 1]]],
    ]
  );
});

const { talentPointsLabel } = require('../src/app/components/forever/specs.ts');

test('talent points read as tree totals, none when the export had none', () => {
  assert.equal(talentPointsLabel([0, 23, 0]), '0 / 23 / 0');
  assert.equal(talentPointsLabel([]), null);
});
