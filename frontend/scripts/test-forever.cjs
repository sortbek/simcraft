require('./register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { blockedReason } = require('../src/app/components/forever/specs.ts');

test('below level 60 needs the character stats from the export', () => {
  assert.equal(blockedReason(27, false, 'retributionPaladin'), 'level');
  assert.equal(blockedReason(27, false, 'holyPaladin'), 'level');
  assert.equal(blockedReason(27, true, 'retributionPaladin'), null);
  assert.equal(blockedReason(9, true, 'retributionPaladin'), 'levelMin');
});
test('a healer spec is blocked, a picked damage spec is not', () => {
  assert.equal(blockedReason(60, false, 'holyPaladin'), 'healer');
  assert.equal(blockedReason(29, true, 'holyPaladin'), 'healer');
  assert.equal(blockedReason(60, false, null), 'healer');
  assert.equal(blockedReason(60, false, 'retributionPaladin'), null);
  assert.equal(blockedReason(60, false, 'dpsPriest'), null);
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

const { deepestTalents } = require('../src/app/components/forever/talentTrees.ts');
const talent = (name, row, col, rank) => ({
  name,
  spell_id: 1,
  icon: '',
  row,
  col,
  max_ranks: 5,
  rank,
});

test('deepest talents: per tree with points, its ranked talents in the deepest ranked row, left to right', () => {
  const trees = [
    { name: 'Holy', points: 0, talents: [talent('h1', 0, 1, 0)] },
    {
      name: 'Protection',
      points: 8,
      talents: [
        talent('p1', 0, 1, 5),
        talent('p3', 2, 2, 1),
        talent('p2', 2, 0, 2),
        talent('p4', 3, 1, 0),
      ],
    },
    { name: 'Retribution', points: 1, talents: [talent('r1', 0, 0, 1)] },
  ];
  assert.deepEqual(
    deepestTalents(trees).map((t) => t.name),
    ['p2', 'p3', 'r1']
  );
});

const { getForeverWowheadUrl } = require('../src/app/lib/useItemInfo.ts');

test("Forever items and talents link to Wowhead's forever pages, on the locale domain", () => {
  assert.equal(getForeverWowheadUrl('item', 273637), 'https://www.wowhead.com/forever/item=273637');
  assert.equal(
    getForeverWowheadUrl('spell', 20262, 'de_DE'),
    'https://de.wowhead.com/forever/spell=20262'
  );
});
