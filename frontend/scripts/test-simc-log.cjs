const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  EMPTY_LIVE_SIM,
  comboList,
  estimateEta,
  parseDuration,
  reduceSimcLog,
  runFraction,
} = require('../src/app/lib/simcLog.ts');

// Real lines from a 17-combo Top Gear run.
const NOTE =
  'Implementation Not Yet Verified: Rune of Unleashed Fire: Procs are assumed to target the same unit that triggered them.';
const HEADER = [
  NOTE,
  NOTE,
  'SimulationCraft 1210-01 for World of Warcraft 12.1.0.69933 Live (hotfix 2026-10-03/69933, git build midnight cafc272)',
  'Simulating... ( iterations=100000, threads=29, target_error=0.050, max_time=300, vary_combat_length=0.20, optimal_raid=1, fight_style=Patchwerk )',
];
const BASELINE = [
  'Generating Baseline: Ðtf 1/17 [==>.................] 2272/17401 56.014 Mean=185550 Error=0.140% 9sec',
  'Generating Baseline: Ðtf 1/17 [===================>] 16646/16646 58.977 Mean=185340 Error=0.050% 9.732',
];
const COMBO2 = [
  NOTE,
  'Generating Profileset: Combo 2 2/17 [==>.................] 2209/16294 56.361 Mean=187116 Error=0.139% 8sec',
  'Generating Profileset: Combo 2 2/17 [===================>] 16635/16635 56.566 Mean=187312 Error=0.050% 10.140',
];
const COMBO3 = [
  NOTE,
  'Generating Profileset: Combo 3 3/17 [=========>..........] 8432/16377 55.669 Mean=186840 Error=0.070% 4sec (2m, 30s)',
];

test('header: version, build and sim options', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, HEADER);
  assert.equal(s.version, '1210-01');
  assert.equal(s.build, 'midnight cafc272');
  assert.equal(s.options.threads, '29');
  assert.equal(s.options.fight_style, 'Patchwerk');
  assert.equal(s.runs, 1);
});

test('combos: live progress, finished DPS and elapsed time, overall ETA', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [...HEADER, ...BASELINE, ...COMBO2, ...COMBO3]);
  assert.equal(s.total, 17);
  assert.equal(s.current, 3);
  const [base, c2, c3] = comboList(s);
  assert.deepEqual(
    [base.isBaseline, base.name, base.mean, base.done, base.elapsed],
    [true, 'Ðtf', 185340, true, 9.732]
  );
  assert.deepEqual([c2.name, c2.mean, c2.done, c2.elapsed], ['Combo 2', 187312, true, 10.14]);
  assert.deepEqual(
    [c3.done, c3.iterations, c3.target, c3.errorPct, c3.eta],
    [false, 8432, 16377, 0.07, 4]
  );
  assert.equal(s.overallEta, 150);
  assert.equal(estimateEta(s), 150);
  assert.ok(runFraction(s) > 2 / 17 && runFraction(s) < 3 / 17);
});

test('repeated SimC notes collapse into one with a count', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [...HEADER, ...BASELINE, ...COMBO2, ...COMBO3]);
  assert.deepEqual(s.notes, [{ text: NOTE, count: 4 }]);
});

test('folding in batches matches folding all at once', () => {
  const all = [...HEADER, ...BASELINE, ...COMBO2, ...COMBO3];
  let s = EMPTY_LIVE_SIM;
  for (let i = 0; i < all.length; i += 3) s = reduceSimcLog(s, all.slice(i, i + 3));
  assert.deepEqual(s, reduceSimcLog(EMPTY_LIVE_SIM, all));
});

test('a new SimC run (next stage) starts its combos afresh', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [...HEADER, ...BASELINE, ...HEADER]);
  assert.equal(s.runs, 2);
  assert.deepEqual(s.combos, {});
});

test('ETA falls back to finished combos pace before SimC prints one', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [...HEADER, ...BASELINE, ...COMBO2.slice(0, 2)]);
  assert.equal(s.overallEta, undefined);
  // 8s left on combo 2, then 15 more combos at ~9.7s each.
  assert.equal(estimateEta(s), Math.round(8 + 15 * 9.732));
});

test('single-actor sim lines without a combo index', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [
    'Generating Baseline: Thrall [====>...............] 3000/12000 50.1 Mean=150000 Error=0.200% 12sec',
  ]);
  assert.equal(s.total, 0);
  assert.equal(comboList(s)[0].mean, 150000);
  assert.equal(runFraction(s), 0.25);
});

test('durations', () => {
  assert.equal(parseDuration('2m, 34s'), 154);
  assert.equal(parseDuration('1h, 2m'), 3720);
  assert.equal(parseDuration('nope'), undefined);
});

test('finished combos drop their chart samples; the header lines are kept', () => {
  const s = reduceSimcLog(EMPTY_LIVE_SIM, [...HEADER, ...BASELINE, ...COMBO2, ...COMBO3]);
  const [base, c2, c3] = comboList(s);
  assert.deepEqual([base.samples, c2.samples], [[], []]);
  assert.equal(c3.samples.length, 1);
  assert.deepEqual(s.header, [HEADER[2], HEADER[3]]);
});
