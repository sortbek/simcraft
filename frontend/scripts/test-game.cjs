require('./register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { detectGame } = require('../src/app/lib/game.ts');

test('forever header', () => {
  assert.equal(detectGame('# Sylfrey\n# SimC Addon 12.1.5-01\n# WoW 1.60.1.70374, TOC 16001\n'), 'forever');
});
test('retail header', () => {
  assert.equal(detectGame('# WoW 12.0.5.66102, TOC 120005\n'), 'retail');
});
test('no header', () => {
  assert.equal(detectGame('paladin="X"\nlevel=80\n'), 'retail');
});
