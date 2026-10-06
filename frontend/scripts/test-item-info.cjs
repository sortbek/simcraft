const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { chunk } = require('../src/app/lib/useItemInfo.ts');

test('splits a lookup over the backend cap into capped requests', () => {
  const ids = Array.from({ length: 117 }, (_, i) => i);
  const parts = chunk(ids, 100);
  assert.deepEqual(
    parts.map((p) => p.length),
    [100, 17]
  );
  assert.deepEqual(parts.flat(), ids);
});

test('a lookup under the cap stays one request', () => {
  assert.deepEqual(chunk([1, 2, 3], 100), [[1, 2, 3]]);
});
