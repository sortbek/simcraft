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
