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

test("switched off, nothing is installed and the backend is told", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { ensureForever, setDisabled } = require("./download-forever");
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "forever-test-")), "forever");
  assert.equal(await ensureForever(dir, { enabled: false }), null);
  assert.ok(fs.existsSync(path.join(dir, ".disabled")));
  setDisabled(dir, false);
  assert.ok(!fs.existsSync(path.join(dir, ".disabled")));
});

test("with auto-update off an installed engine is kept without asking GitHub", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { ensureForever, BINARY_NAME } = require("./download-forever");
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "forever-test-")), "forever");
  const tag = "forever-20261015-e3b44d0";
  fs.mkdirSync(path.join(dir, tag), { recursive: true });
  fs.writeFileSync(path.join(dir, tag, BINARY_NAME), "");
  fs.writeFileSync(path.join(dir, ".active"), tag);
  assert.equal(await ensureForever(dir, { autoUpdate: false }), path.join(dir, tag));
});
