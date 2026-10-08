const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { buildShareSummary, simcBuildOf } = require('../src/app/lib/share/summary.ts');
const { parseShareInput, shareUrl } = require('../src/app/lib/share/link.ts');
const {
  buildRerunRequest,
  checkPayloadVersion,
  checkResultShape,
} = require('../src/app/lib/share/rerun.ts');
const { compareResults, compareShared, comboKey } = require('../src/app/lib/share/compare.ts');
const { gunzipBase64 } = require('../src/app/lib/share/api.ts');
const { gzipSync } = require('node:zlib');

const common = {
  player_name: 'Thrall',
  player_class: 'Frost Mage',
  realm: 'draenor',
  region: 'eu',
  fight_length: 300,
  desired_targets: 1,
};

test('single-actor summary', () => {
  const s = buildShareSummary({
    ...common,
    dps: 123456.7,
    dps_error: 120,
    stat_weights: { Haste: 1.2 },
  });
  assert.deepEqual(s, {
    v: 1,
    kind: 'single_actor',
    character: 'Thrall',
    realm: 'draenor',
    region: 'eu',
    playerClass: 'Frost Mage',
    fightLength: 300,
    targets: 1,
    dps: 123456.7,
    dpsError: 120,
    statWeights: { Haste: 1.2 },
  });
});

test('gear summary: top 10 by dps, gain vs base, only changed items', () => {
  const results = Array.from({ length: 12 }, (_, i) => ({
    name: `c${i}`,
    dps: 100000 + i * 1000,
    delta: i * 1000,
    precision_pct: 0.1,
    items: [
      { slot: 'trinket1', item_id: 500 + i, ilevel: 678, name: `T${i}`, is_kept: false },
      { slot: 'head', item_id: 1, ilevel: 670, name: 'Kept', is_kept: true },
      { slot: 'off_hand', item_id: 0, ilevel: 0, name: '', is_kept: false },
    ],
  }));
  const s = buildShareSummary({
    ...common,
    result_kind: 'gear_comparison',
    type: 'top_gear',
    base_dps: 100000,
    results,
  });
  assert.equal(s.kind, 'gear_comparison');
  assert.equal(s.mode, 'top_gear');
  assert.equal(s.rows.length, 10);
  assert.equal(s.rows[0].dps, 111000);
  assert.equal(s.rows[0].gainPct, 11);
  assert.deepEqual(s.rows[0].items, [{ slot: 'trinket1', itemId: 511, name: 'T11', ilvl: 678 }]);
});

test('summary strings are clamped to website limits', () => {
  const s = buildShareSummary({ ...common, player_name: 'x'.repeat(100), dps: 1 });
  assert.equal(s.character.length, 64);
});

test('missing realm/region become null; zero base dps gives 0% gain', () => {
  const s = buildShareSummary({
    ...common,
    realm: undefined,
    region: undefined,
    result_kind: 'gear_comparison',
    type: 'droptimizer',
    base_dps: 0,
    results: [{ name: 'a', dps: 5, delta: 5, items: [] }],
  });
  assert.equal(s.realm, null);
  assert.equal(s.region, null);
  assert.equal(s.rows[0].gainPct, 0);
});

test('stat weights over 20 are capped to the 20 largest by |weight|', () => {
  const weights = {};
  for (let i = 1; i <= 25; i++) weights[`W${i}`] = i % 2 === 0 ? i : -i;
  const s = buildShareSummary({ ...common, dps: 1, stat_weights: weights });
  const keys = Object.keys(s.statWeights);
  assert.equal(keys.length, 20);
  assert.deepEqual(keys.sort(), Array.from({ length: 20 }, (_, i) => `W${i + 6}`).sort());
  assert.equal(s.statWeights.W5, undefined);
  assert.equal(s.statWeights.W25, -25);
});

test('parseShareInput accepts urls and bare ids, rejects others', () => {
  assert.equal(parseShareInput('https://simhammer.com/sim/K3Fq9xTz2a'), 'K3Fq9xTz2a');
  assert.equal(parseShareInput('  simhammer.com/sim/K3Fq9xTz2a?x=1 '), 'K3Fq9xTz2a');
  assert.equal(parseShareInput('simhammer://sim/K3Fq9xTz2a'), 'K3Fq9xTz2a');
  assert.equal(parseShareInput('K3Fq9xTz2a'), 'K3Fq9xTz2a');
  assert.equal(parseShareInput('https://evil.com/sim/K3Fq9xTz2a'), null);
  assert.equal(parseShareInput('K3Fq9'), null);
  assert.equal(shareUrl('K3Fq9xTz2a'), 'https://simhammer.com/sim/K3Fq9xTz2a');
});

const payload = (over = {}) => ({
  v: 1,
  requestVersion: 1,
  mode: 'top_gear',
  result: {},
  simcInput: 'x',
  request: {
    simc_input: 'x',
    compute_provider: 'simmit',
    batch_id: 'b-1',
    threads: 32,
    simc_branch: 'nightly',
    fight_style: 'Patchwerk',
  },
  ...over,
});

test('re-run forces local, strips batch, threads and SimC branch, tags rerun_of, picks endpoint', () => {
  const r = buildRerunRequest(payload(), 'K3Fq9xTz2a');
  assert.equal(r.endpoint, '/api/top-gear/sim');
  assert.deepEqual(r.body, {
    simc_input: 'x',
    compute_provider: 'local',
    fight_style: 'Patchwerk',
    rerun_of: 'K3Fq9xTz2a',
  });
});

test('endpoints per mode', () => {
  for (const [mode, ep] of [
    ['quick', '/api/sim'],
    ['stat_weights', '/api/sim'],
    ['droptimizer', '/api/droptimizer/sim'],
    ['upgrade_compare', '/api/upgrade-compare/sim'],
  ]) {
    assert.equal(buildRerunRequest(payload({ mode }), 'K3Fq9xTz2a').endpoint, ep);
  }
});

test('re-run refused without request, newer request version, or unknown mode', () => {
  assert.deepEqual(buildRerunRequest(payload({ request: null }), 'K3Fq9xTz2a'), {
    error: 'not_rerunnable',
  });
  assert.deepEqual(buildRerunRequest(payload({ requestVersion: 2 }), 'K3Fq9xTz2a'), {
    error: 'incompatible',
  });
  assert.deepEqual(buildRerunRequest(payload({ mode: 'roster' }), 'K3Fq9xTz2a'), {
    error: 'unknown_mode',
  });
});

test('payload version check', () => {
  assert.equal(checkPayloadVersion({ v: 1 }), 'ok');
  assert.equal(checkPayloadVersion({ v: 2 }), 'too_new');
});

test('comboKey ignores kept items and item order', () => {
  const a = [
    { slot: 'trinket1', item_id: 5, bonus_ids: [2, 1], is_kept: false },
    { slot: 'head', item_id: 1, is_kept: true },
  ];
  const b = [{ slot: 'trinket1', item_id: 5, bonus_ids: [1, 2], is_kept: false }];
  assert.equal(comboKey(a), comboKey(b));
  assert.notEqual(comboKey(a, 'talA'), comboKey(a, 'talB'));
});

test('comboKey separates consumable mixes and keeps old keys unchanged', () => {
  const items = [{ slot: 'head', item_id: 1, is_kept: false }];
  assert.equal(comboKey(items, '', '', {}), comboKey(items));
  assert.notEqual(comboKey(items, '', '', { flask: 'a' }), comboKey(items, '', '', { flask: 'b' }));
  assert.equal(
    comboKey(items, '', '', { food: 'f', flask: 'a' }),
    comboKey(items, '', '', { flask: 'a', food: 'f' })
  );
});

test('single-actor comparison flags big gaps only', () => {
  const shared = {
    player_name: 'T',
    player_class: 'M',
    fight_length: 300,
    dps: 100000,
    dps_error_pct: 0.2,
  };
  assert.equal(compareResults(shared, { ...shared, dps: 100100 }).flagged, false);
  const c = compareResults(shared, { ...shared, dps: 105000 });
  assert.equal(c.flagged, true);
  assert.equal(Math.round(c.deltaPct * 10) / 10, 5);
});

test('gear comparison matches by item set, missing rows get null', () => {
  const base = {
    player_name: 'T',
    player_class: 'M',
    fight_length: 300,
    result_kind: 'gear_comparison',
    type: 'top_gear',
    base_dps: 100000,
  };
  const row = (id, dps) => ({
    name: `c${id}`,
    dps,
    delta: dps - 100000,
    precision_pct: 0.1,
    items: [{ slot: 'trinket1', item_id: id, is_kept: false, name: `I${id}`, ilevel: 1 }],
  });
  const shared = { ...base, results: [row(1, 105000), row(2, 103000)] };
  const local = { ...base, results: [row(2, 103100), row(1, 104900)] };
  const c = compareResults(shared, local);
  assert.equal(c.kind, 'gear');
  assert.equal(c.rows[0].label, 'I1');
  assert.equal(c.rows[0].localGainPct, 4.9);
  assert.equal(c.rows[0].flagged, false);
  const c2 = compareResults(shared, { ...base, results: [row(2, 103000)] });
  assert.equal(c2.rows[0].localGainPct, null);
});

test('gear comparison matches same-slot gem variants to their correct local counterpart', () => {
  // Gem-only delta rows (emit.rs::build_gem_entry) carry a singular `gem_id`, not `gem_ids`.
  const base = {
    player_name: 'T',
    player_class: 'M',
    fight_length: 300,
    result_kind: 'gear_comparison',
    type: 'top_gear',
    base_dps: 100000,
  };
  const gemRow = (gemId, dps) => ({
    name: `gem${gemId}`,
    dps,
    delta: dps - 100000,
    precision_pct: 0.1,
    items: [{ slot: 'trinket1', type: 'gem', gem_id: gemId, name: `Gem${gemId}` }],
  });
  const shared = { ...base, results: [gemRow(1, 105000), gemRow(2, 103000)] };
  const local = { ...base, results: [gemRow(2, 103100), gemRow(1, 104900)] };
  const c = compareResults(shared, local);
  assert.notEqual(
    comboKey(shared.results[0].items),
    comboKey(shared.results[1].items),
    'different gem_id at the same slot must produce different comboKeys'
  );
  assert.equal(c.rows[0].label, 'Gem1');
  assert.equal(c.rows[0].localGainPct, 4.9);
  assert.equal(c.rows[1].label, 'Gem2');
  assert.equal(c.rows[1].localGainPct, 3.1);
});

test('gem-only delta row label falls back to the gem name, not the combo name', () => {
  const base = {
    player_name: 'T',
    player_class: 'M',
    fight_length: 300,
    result_kind: 'gear_comparison',
    type: 'top_gear',
    base_dps: 100000,
  };
  const row = {
    name: 'c1',
    dps: 101000,
    delta: 1000,
    precision_pct: 0.1,
    items: [{ slot: 'trinket1', type: 'gem', gem_id: 7, name: 'Deadly Gem' }],
  };
  const c = compareResults({ ...base, results: [row] }, { ...base, results: [row] });
  assert.equal(c.rows[0].label, 'Deadly Gem');
});

test('simcBuildOf falls back past empty strings and clamps to 64 chars', () => {
  assert.equal(simcBuildOf({ simc_git_revision: '', simc_version: '1101-01' }), '1101-01');
  assert.equal(simcBuildOf({ simc_git_revision: 'abc', simc_version: 'v' }), 'abc');
  assert.equal(simcBuildOf({ simc_git_revision: '', simc_version: '' }), null);
  assert.equal(simcBuildOf({}), null);
  assert.equal(simcBuildOf({ simc_git_revision: 'x'.repeat(100) }), 'x'.repeat(64));
});

test('gunzipBase64 inflates within the cap and throws above it', async () => {
  const b64 = gzipSync(Buffer.from('a'.repeat(1000))).toString('base64');
  assert.equal(await gunzipBase64(b64, 1000), 'a'.repeat(1000));
  await assert.rejects(gunzipBase64(b64, 999));
});

test('checkResultShape accepts single and gear results, rejects malformed ones', () => {
  const base = { player_name: 'Thrall', fight_length: 300 };
  assert.equal(checkResultShape({ ...base, dps: 1 }), null);
  assert.equal(checkResultShape({ ...base, result_kind: 'gear_comparison', results: [] }), null);
  assert.equal(checkResultShape({ ...base, type: 'top_gear', results: [] }), null);
  for (const bad of [
    null,
    'x',
    [],
    { ...base },
    { ...base, dps: '1' },
    { ...base, result_kind: 'gear_comparison', results: {} },
    { player_name: 1, fight_length: 300, dps: 1 },
    { player_name: 'Thrall', dps: 1 },
  ])
    assert.equal(typeof checkResultShape(bad), 'string');
});

test('compareShared returns null for a malformed shared result instead of throwing', () => {
  const local = { ...common, dps: 100000 };
  assert.equal(compareShared(null, local), null);
  assert.equal(
    compareShared({ ...common, result_kind: 'gear_comparison', results: 'x' }, local),
    null
  );
  const gear = { ...common, result_kind: 'gear_comparison', base_dps: 1 };
  assert.equal(compareShared({ ...gear, results: [null] }, { ...gear, results: [] }), null);
  assert.equal(compareShared({ ...common, dps: 100000 }, local).kind, 'single');
});

test('NEXT_PUBLIC_SHARE_ORIGIN overrides the share origin and its links parse', () => {
  const linkPath = require.resolve('../src/app/lib/share/link.ts');
  delete require.cache[linkPath];
  process.env.NEXT_PUBLIC_SHARE_ORIGIN = 'http://localhost:3001/';
  try {
    const link = require(linkPath);
    assert.equal(link.SHARE_ORIGIN, 'http://localhost:3001');
    assert.equal(link.shareUrl('K3Fq9xTz2a'), 'http://localhost:3001/sim/K3Fq9xTz2a');
    assert.equal(link.parseShareInput('http://localhost:3001/sim/K3Fq9xTz2a'), 'K3Fq9xTz2a');
    assert.equal(link.parseShareInput('https://simhammer.com/sim/K3Fq9xTz2a'), 'K3Fq9xTz2a');
    assert.equal(link.parseShareInput('http://localhost:3002/sim/K3Fq9xTz2a'), null);
    assert.equal(link.parseShareInput('http://localhost:3001.evil.com/sim/K3Fq9xTz2a'), null);
  } finally {
    delete process.env.NEXT_PUBLIC_SHARE_ORIGIN;
    delete require.cache[linkPath];
  }
});

test('share lookups snapshot only what the report renders, and prime the caches', () => {
  const { collectShareLookups, primeShareLookups } = require('../src/app/lib/share/lookups.ts');
  const { encodeTalentString } = require('../src/app/lib/talentEncode.ts');
  const tree = {
    specId: 64,
    classNodes: [{ id: 1, entries: [{ icon: 'Spell_Frost_Talent' }] }],
    specNodes: [],
    heroNodes: [],
    fullNodeOrder: [],
    fullNodeMaxRanks: {},
  };
  const item = (id, icon) => ({ item_id: id, name: `I${id}`, quality: 4, icon, ilevel: 600 });
  primeShareLookups({
    items: { 10: item(10, 'inv_a'), '11:2:5': item(11, 'inv_b'), 99: item(99, 'inv_unused') },
    enchants: { 7: { enchant_id: 7, name: 'E' }, 8: { enchant_id: 8, name: 'Unused' } },
    gems: { 3: { gem_id: 3, name: 'G', icon: 'inv_gem', quality: 4 } },
    iconFileIds: { inv_a: 1, inv_gem: 2, spell_frost_talent: 3, inv_unused: 4 },
    talentTrees: { 64: tree },
  });

  const result = {
    result_kind: 'gear_comparison',
    base_dps: 1,
    talent_string: encodeTalentString(new Map(), tree, 64),
    equipped_gear: { head: { slot: 'head', item_id: 10, enchant_id: 7 } },
    results: [
      {
        name: 'c',
        dps: 2,
        delta: 1,
        items: [{ slot: 'neck', item_id: 11, bonus_ids: [5, 2], gem_ids: [3] }],
      },
    ],
  };
  const l = collectShareLookups(result);
  assert.deepEqual(Object.keys(l.items).sort(), ['10', '11:2:5']);
  assert.deepEqual(Object.keys(l.enchants), ['7']);
  assert.deepEqual(Object.keys(l.gems), ['3']);
  assert.deepEqual(l.iconFileIds, { inv_a: 1, inv_gem: 2, spell_frost_talent: 3 });
  assert.equal(l.talentTrees[64], tree);

  const single = collectShareLookups({ dps: 1, equipped_gear: { head: { item_id: 10 } } });
  assert.deepEqual(Object.keys(single.items), ['10']);
  assert.equal(single.talentTrees, undefined);
});

test('priming takes over names and icon ids and ignores prototype keys', () => {
  const { primeShareLookups } = require('../src/app/lib/share/lookups.ts');
  const { localizedItemName, iconProps } = require('../src/app/lib/useItemInfo.ts');
  const { cachedTalentTree } = require('../src/app/lib/useTalentTree.ts');
  primeShareLookups(
    JSON.parse(
      '{"itemNames":{"500":{"de_DE":"Helm"}},"iconFileIds":{"inv_helm":42},' +
        '"items":{"__proto__":{"polluted":1}},"talentTrees":{"__proto__":{"polluted":1}}}'
    )
  );
  assert.equal(localizedItemName(500, 'Helmet', 'de_DE'), 'Helm');
  assert.match(iconProps('INV_Helm').src, /\/42\.jpg$/);
  assert.equal(cachedTalentTree('polluted'), undefined);
  assert.equal({}.polluted, undefined);
});

test('the viewer build fetches shares from its own origin', () => {
  const linkPath = require.resolve('../src/app/lib/share/link.ts');
  delete require.cache[linkPath];
  process.env.NEXT_PUBLIC_VIEWER_BUILD = '1';
  try {
    const link = require(linkPath);
    assert.equal(link.SHARE_ORIGIN, '');
    assert.equal(link.parseShareInput('K3Fq9xTz2a'), 'K3Fq9xTz2a');
  } finally {
    delete process.env.NEXT_PUBLIC_VIEWER_BUILD;
    delete require.cache[linkPath];
  }
});

test('a shared request becomes the sharer settings over the viewer machine settings', () => {
  const { sharedConfig } = require('../src/app/lib/share/editShared.ts');
  const { DEFAULT_PROFILE_DATA } = require('../src/app/lib/sim-config-defaults.ts');
  const own = { ...DEFAULT_PROFILE_DATA, threads: 12, simcBranch: 'nightly', customApl: 'mine' };
  const c = sharedConfig(
    {
      fight_style: 'HecticAddCleave',
      desired_targets: 3,
      max_time: 240,
      iterations: 5000,
      target_error: 0.2,
      raid_buffs: { bloodlust: 0, arcane_intellect: 1 },
      consumables: { flask: 'flask_x' },
      expansion_options: { 'midnight.crucible_of_erratic_energies_violence': 0 },
      sim_type: 'stat_weights',
    },
    'quick',
    own
  );
  assert.equal(c.fightStyle, 'HecticAddCleave');
  assert.equal(c.targetCount, 3);
  assert.equal(c.fightLength, 240);
  assert.equal(c.iterations, 5000);
  assert.equal(c.raidBuffs.bloodlust, false);
  assert.equal(c.raidBuffs.battle_shout, true);
  assert.deepEqual(c.consumables, { flask: 'flask_x' });
  assert.equal(c.expansionOptions['midnight.crucible_of_erratic_energies_violence'], false);
  assert.equal(c.customApl, '');
  assert.equal(c.statWeights, true);
  assert.equal(c.threads, 12);
  assert.equal(c.simcBranch, 'nightly');
});

test('the shared loadout becomes the active talents line', () => {
  const { withActiveTalents } = require('../src/app/lib/share/editShared.ts');
  const input = 'mage="x"\ntalents=OLD\n# Saved Loadout: B\n# talents=OTHER';
  assert.equal(
    withActiveTalents(input, 'NEW'),
    'mage="x"\ntalents=NEW\n# Saved Loadout: B\n# talents=OTHER'
  );
  assert.equal(withActiveTalents(input, undefined), input);
  assert.equal(withActiveTalents(input, 'A\noutput=x'), input);
});

test('a Top Gear request becomes its saved selection', () => {
  const { topGearStateFromRequest } = require('../src/app/lib/share/editShared.ts');
  const s = topGearStateFromRequest({
    selected_items: { head: ['1::bags:head', 2] },
    equipped_replacements: { neck: '3::bags:neck' },
    enchant_selections: { main_hand: [7, 'x'] },
    gem_options: [9],
    max_upgrade: true,
    catalyst: true,
    catalyst_charges: 2,
  });
  assert.deepEqual(s.selectedUids, { head: ['1::bags:head'] });
  assert.deepEqual(s.excludedEquipped, ['neck']);
  assert.deepEqual(s.enchantSelections, { main_hand: [7] });
  assert.deepEqual(s.gemSelections, [9]);
  assert.equal(s.maxUpgrade, true);
  assert.equal(s.copyEnchants, false);
  assert.equal(s.catalystCharges, 2);
});

test('a shared mode never resolves to an inherited property', () => {
  const { ownEntry, RERUN_ENDPOINTS, buildRerunRequest } = require('../src/app/lib/share/rerun.ts');
  const { EDIT_ROUTES } = require('../src/app/lib/share/editShared.ts');
  for (const mode of ['constructor', '__proto__', 'toString']) {
    assert.equal(ownEntry(RERUN_ENDPOINTS, mode), undefined);
    assert.equal(ownEntry(EDIT_ROUTES, mode), undefined);
  }
  assert.equal(ownEntry(EDIT_ROUTES, 'top_gear'), '/top-gear');
  const r = buildRerunRequest({ v: 1, requestVersion: 1, mode: 'constructor', request: {} }, 'K3Fq9xTz2a');
  assert.deepEqual(r, { error: 'unknown_mode' });
});
