const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const {
  lastDoneBySimType,
  quickSimTrend,
  recentJobs,
  trendChange,
} = require('../src/app/components/home/homeModel.ts');

const job = (id, sim_type, created_at, extra = {}) => ({
  id,
  sim_type,
  created_at,
  status: 'done',
  dps: null,
  ...extra,
});

test('the last finished run per tool wins, whatever order the list arrives in', () => {
  const last = lastDoneBySimType([
    job('a', 'quick', '2026-10-01T10:00:00Z', { dps: 100 }),
    job('b', 'quick', '2026-10-03T10:00:00Z', { dps: 120 }),
    job('c', 'quick', '2026-10-04T10:00:00Z', { status: 'failed' }),
    job('d', 'top_gear', '2026-10-02T10:00:00Z'),
  ]);
  assert.equal(last.quick.id, 'b');
  assert.equal(last.top_gear.id, 'd');
  assert.equal(last.droptimizer, undefined);
});

test('the trend is the last finished Quick Sims with a DPS, oldest first', () => {
  const jobs = [
    job('x', 'quick', '2026-10-05T00:00:00Z', { dps: 300 }),
    job('y', 'top_gear', '2026-10-06T00:00:00Z', { dps: 999 }),
    job('z', 'quick', '2026-10-04T00:00:00Z', { dps: 200 }),
    job('w', 'quick', '2026-10-07T00:00:00Z', { status: 'running', dps: 50 }),
    ...Array.from({ length: 9 }, (_, i) =>
      job(`o${i}`, 'quick', `2026-09-0${i + 1}T00:00:00Z`, { dps: 10 + i })
    ),
  ];
  assert.deepEqual(quickSimTrend(jobs, 4), [17, 18, 200, 300]);
  assert.equal(quickSimTrend([job('s', 'quick', '2026-10-01T00:00:00Z', { dps: 1 })]).length, 1);
});

test('trend change compares the newest point with the oldest', () => {
  assert.equal(trendChange([100, 110, 125]), 0.25);
  assert.equal(trendChange([100]), null);
  assert.equal(trendChange([]), null);
});

test('recent sims are the newest finished or failed runs', () => {
  const jobs = [
    job('old', 'quick', '2026-10-01T00:00:00Z'),
    job('run', 'quick', '2026-10-09T00:00:00Z', { status: 'running' }),
    job('new', 'top_gear', '2026-10-08T00:00:00Z'),
    job('bad', 'droptimizer', '2026-10-07T00:00:00Z', { status: 'failed' }),
  ];
  assert.deepEqual(
    recentJobs(jobs, 2).map((j) => j.id),
    ['new', 'bad']
  );
});
