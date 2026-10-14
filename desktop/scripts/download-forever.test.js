const assert = require("node:assert/strict");
const { test } = require("node:test");
const { tagFromLocation } = require("./download-forever");

test("tag from the releases/latest redirect", () => {
  assert.equal(
    tagFromLocation("https://github.com/sortbek/forever-builds/releases/tag/forever-20261015-e3b44d0"),
    "forever-20261015-e3b44d0"
  );
  assert.equal(tagFromLocation("https://github.com/sortbek/forever-builds/releases"), null);
  assert.equal(tagFromLocation(undefined), null);
});

test("tags that are not a forever release tag are refused", () => {
  const { tagFromLocation } = require("./download-forever");
  assert.equal(tagFromLocation("https://github.com/x/y/releases/tag/forever-20261015-e3b44d0%27%3B%20rm"), null);
  assert.equal(tagFromLocation("https://github.com/x/y/releases/tag/..%2F..%2Fevil"), null);
  assert.equal(tagFromLocation("https://github.com/x/y/releases/tag/v1.2.3"), null);
});

test("an unusable install folder gives null instead of throwing", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { ensureForever } = require("./download-forever");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "forever-test-")), "not-a-dir");
  fs.writeFileSync(file, "x");
  assert.equal(await ensureForever(path.join(file, "forever")), null);
});
