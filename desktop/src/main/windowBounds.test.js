const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultWindowBounds, restoreWindowBounds } = require("./windowBounds");

const fullHd = { x: 0, y: 0, width: 1920, height: 1040 }; // 1080p minus the taskbar

test("opens at 85% of the screen, centred", () => {
  assert.deepEqual(defaultWindowBounds(fullHd), { x: 144, y: 78, width: 1632, height: 884 });
});

test("never larger than 1680x1050 on big screens", () => {
  const b = defaultWindowBounds({ x: 0, y: 0, width: 3840, height: 2120 });
  assert.equal(b.width, 1680);
  assert.equal(b.height, 1050);
  assert.equal(b.x, 1080);
});

test("at least 1200x800, but never past a small screen", () => {
  assert.deepEqual(defaultWindowBounds({ x: 0, y: 0, width: 1366, height: 728 }), {
    x: 83,
    y: 0,
    width: 1200,
    height: 728,
  });
});

test("a window that was left on a connected screen comes back as it was", () => {
  const saved = { x: 200, y: 100, width: 1500, height: 900 };
  assert.deepEqual(restoreWindowBounds(saved, [fullHd]), saved);
});

test("a window left on an unplugged monitor is not restored", () => {
  assert.equal(restoreWindowBounds({ x: 2500, y: 100, width: 1500, height: 900 }, [fullHd]), null);
});

test("a saved size bigger than the screen now is shrunk to fit", () => {
  assert.deepEqual(restoreWindowBounds({ x: 0, y: 0, width: 2400, height: 1400 }, [fullHd]), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
  });
});

test("missing or broken saved state is ignored", () => {
  assert.equal(restoreWindowBounds(null, [fullHd]), null);
  assert.equal(restoreWindowBounds({ x: 0, y: 0, width: "big" }, [fullHd]), null);
});
