const test = require("node:test");
const assert = require("node:assert");
const { autoUpdateBranches } = require("./simc");

const settings = (values) => (key, fallback) => (key in values ? values[key] : fallback);
const both = [{ type: "weekly" }, { type: "nightly" }];

test("each switch updates its own branch", () => {
  assert.deepStrictEqual(
    autoUpdateBranches(settings({ simc_auto_update: true, simc_use_nightly: true }), both),
    ["weekly", "nightly"]
  );
  assert.deepStrictEqual(
    autoUpdateBranches(settings({ simc_auto_update: false, simc_use_nightly: true }), both),
    ["nightly"]
  );
  assert.deepStrictEqual(
    autoUpdateBranches(settings({ simc_auto_update: true, simc_use_nightly: false }), both),
    ["weekly"]
  );
});

test("a branch that is not installed is not installed by auto-update", () => {
  assert.deepStrictEqual(
    autoUpdateBranches(settings({ simc_use_nightly: true }), [{ type: "weekly" }]),
    ["weekly"]
  );
});

test("defaults keep Weekly up to date and leave Nightly alone", () => {
  assert.deepStrictEqual(autoUpdateBranches(settings({}), both), ["weekly"]);
});
