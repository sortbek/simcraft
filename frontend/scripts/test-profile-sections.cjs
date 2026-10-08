const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  dirtyProfileSections,
  PROFILE_SECTION_FIELDS,
  stableStringify,
} = require('../src/app/lib/profile-sections.ts');
const { DEFAULT_PROFILE_DATA } = require('../src/app/lib/sim-config-defaults.ts');

const base = () => JSON.parse(JSON.stringify(DEFAULT_PROFILE_DATA));

test('identical configs have no dirty sections', () => {
  assert.deepEqual(dirtyProfileSections(base(), base()), []);
});

test('each section lights only for its own fields', () => {
  const live = base();
  live.targetCount = 4;
  assert.deepEqual(dirtyProfileSections(base(), live), ['fight']);

  const buffs = base();
  buffs.consumables = { flask: 'flask_of_the_shattered_sun_2' };
  assert.deepEqual(dirtyProfileSections(base(), buffs), ['buffs']);

  const adv = base();
  adv.simcFooter = 'iterations=5';
  assert.deepEqual(dirtyProfileSections(base(), adv), ['advanced']);
});

test('rotation mode counts as fight, not advanced', () => {
  const live = base();
  live.rotationMode = 'one_button';
  assert.deepEqual(dirtyProfileSections(base(), live), ['fight']);
});

test('stat weights and threads belong to no section', () => {
  const live = base();
  live.statWeights = true;
  live.threads = 12;
  assert.deepEqual(dirtyProfileSections(base(), live), []);
});

test('record key order never makes a section dirty', () => {
  const saved = base();
  const live = base();
  saved.raidBuffs = { bloodlust: true, skyfury: false };
  live.raidBuffs = { skyfury: false, bloodlust: true };
  assert.deepEqual(dirtyProfileSections(saved, live), []);
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test('every profile field except statWeights and threads is in exactly one section', () => {
  const mapped = Object.values(PROFILE_SECTION_FIELDS).flat();
  assert.equal(new Set(mapped).size, mapped.length);
  const expected = Object.keys(DEFAULT_PROFILE_DATA)
    .filter((k) => k !== 'statWeights' && k !== 'threads')
    .sort();
  assert.deepEqual([...mapped].sort(), expected);
});
