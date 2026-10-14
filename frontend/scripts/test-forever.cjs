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
