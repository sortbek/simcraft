const MIN = { width: 1200, height: 800 };
const MAX = { width: 1680, height: 1050 };
const SHARE = 0.85;
// How much of a saved window must still be on some screen to restore it there.
const MIN_VISIBLE = { width: 120, height: 60 };

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** First launch: 85% of the screen's usable area within sensible limits, centred. */
function defaultWindowBounds(workArea) {
  const width = clamp(Math.round(workArea.width * SHARE), Math.min(MIN.width, workArea.width), MAX.width);
  const height = clamp(Math.round(workArea.height * SHARE), Math.min(MIN.height, workArea.height), MAX.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** The saved window, fitted to the screen it is on; null when it is malformed or
 *  sits on a monitor that is no longer connected. */
function restoreWindowBounds(saved, workAreas) {
  if (!saved || !["x", "y", "width", "height"].every((k) => Number.isFinite(saved[k]))) return null;
  const area = workAreas.find((a) => {
    const o = overlap(saved, a);
    return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height;
  });
  if (!area) return null;
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  return {
    x: clamp(saved.x, area.x, area.x + area.width - width),
    y: clamp(saved.y, area.y, area.y + area.height - height),
    width,
    height,
  };
}

module.exports = {
  defaultWindowBounds,
  restoreWindowBounds,
};
