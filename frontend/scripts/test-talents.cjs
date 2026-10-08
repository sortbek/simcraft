const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');
const { decodeSelections, diffBuilds, summarizeBuild } = require('../src/app/lib/talentSummary.ts');

// The real Beast Mastery tree, as /api/talent-tree serves it (minus fullNodeMaxRanks,
// which the decoder falls back from).
const trees = require(path.join(__dirname, '../../backend/resources/data/talents.json'));
const tree = (Array.isArray(trees) ? trees : Object.values(trees)).find((t) => t.specId === 253);

// A real character's equipped build and one of its saved in-game loadouts.
const EQUIPPED =
  'C0PAD57yiELKEty14ekTDtZEqAMmxwCsBzwQDbAAYGPwMzsMzwMzMjZGMzYmhZGzMzYbmZYMDLDNDAAAAAAAAmHYMzAmZjAmFw2AwA';
const SAVED =
  'C0PAD57yiELKEty14ekTDtZEqAMmxwCsAzwghNAAMjZmZWegZMzMzMmZwMjZGmZMzMjtZmxMmhlxYGAAAAAAAA4BGjBMzGAmFw2AA';

test('a build summarizes to its points and hero tree', () => {
  const s = summarizeBuild(decodeSelections(EQUIPPED, tree), tree);
  assert.deepEqual(s.points, { class: 34, spec: 34, hero: 13 });
  assert.equal(s.heroName, 'Pack Leader');
  assert.ok(s.heroIcon);
  assert.ok(s.highlights.length > 0, 'choice nodes and capstones are listed');
});

test('another spec does not decode against this tree', () => {
  const mm =
    'C4PAAAAAAAAAAAAAAAAAAAAAAwCMwMGzYZAjZwGAAAAAAAAYGzYmFzYmZMDGTzYwYbZmZmZmZmZWYmlBzAAAGzMjBwM22gBYjZ2mxAA';
  assert.equal(decodeSelections(mm, tree), null);
  assert.equal(decodeSelections('not a talent string', tree), null);
});

test('a saved loadout diffs against the equipped build talent by talent', () => {
  const d = diffBuilds(decodeSelections(EQUIPPED, tree), decodeSelections(SAVED, tree), tree);
  const names = (list) => list.map((c) => c.node.name).sort();
  assert.equal(d.heroSwap, false);
  assert.deepEqual(names(d.gained), ['Aspect of the Beast', 'Misdirection', 'Pathfinding']);
  assert.deepEqual(names(d.lost), ['Binding Shot', 'Bloody Frenzy', "Scout's Instincts"]);
  assert.equal(d.changed.length, 3, 'rank and choice changes count once each');
  assert.equal(d.count, 9);
});

test('a build compared with itself has no changes', () => {
  const sel = decodeSelections(SAVED, tree);
  assert.equal(diffBuilds(sel, sel, tree).count, 0);
});
