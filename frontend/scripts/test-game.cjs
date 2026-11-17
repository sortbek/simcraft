require('./register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { detectGame } = require('../src/app/lib/game.ts');

test('forever header', () => {
  assert.equal(
    detectGame('# Sylfrey\n# SimC Addon 12.1.5-01\n# WoW 1.60.1.70374, TOC 16001\n'),
    'forever'
  );
});
test('retail header', () => {
  assert.equal(detectGame('# WoW 12.0.5.66102, TOC 120005\n'), 'retail');
});
test('no header', () => {
  assert.equal(detectGame('paladin="X"\nlevel=80\n'), 'retail');
});

test('the MythicSim addon export is a Forever export', () => {
  assert.equal(
    detectGame('{"version":"0.4.3","name":"Sortbek","mythicsim":{"exporter":"MythicSim"}}'),
    'forever'
  );
  assert.equal(detectGame('  {"name":"x"}'), 'retail');
});

const { exportPreview, mythicSimName, parseCharacterInfo } = require('../src/app/lib/character.ts');
test('a MythicSim export names its character, second name and all', () => {
  const json =
    '{"version":"0.4.3","name":"Sortbek","realm":"Hunter","class":"hunter","mythicsim":{"region":"eu"}}';
  assert.deepEqual(parseCharacterInfo(json), {
    className: 'hunter',
    name: 'Sortbek Hunter',
    spec: 'unknown',
    realm: null,
    region: 'eu',
  });
  assert.equal(exportPreview(json), 'MythicSim · Sortbek Hunter');
  assert.equal(mythicSimName('Sortbek', 'camwow_eu5_realm_6_pvp'), 'Sortbek');
  assert.equal(mythicSimName('Sortbek', 'Realm 6'), 'Sortbek');
  assert.equal(exportPreview('# Sylfrey - 2026\nlevel=27'), '# Sylfrey - 2026');
});
