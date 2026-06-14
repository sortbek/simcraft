'use client';

import { memo } from 'react';
import { T } from '../route-map/routeTheme';

/** Route-card thumbnail. When the route's real `shape` (pull centroids) is known
 *  it draws the actual route — dots in pull order joined by a path, fitted to the
 *  card. Otherwise (SimC/footer routes, or a shape not computed yet) it falls back
 *  to a deterministic decorative scatter keyed off the route id. */
const DOT_COLORS = [
  '#3f8fd0',
  '#5fbf6a',
  '#6ea7cc',
  '#9aa83f',
  '#4fc5a8',
  '#8284d8',
  '#9a8ce6',
  '#d65fb8',
  '#7fd6c0',
  '#e08a3f',
];

interface Dot {
  x: number;
  y: number;
  color: string;
  boss: boolean;
}

/** A real pull centroid from the backend, normalized to [0,1] in the map frame. */
export interface ShapePoint {
  x: number;
  y: number;
  boss: boolean;
}

/** Fit real centroids to the card: scale each axis so the route's bounding box
 *  fills the thumbnail with a small margin (degenerate axes center at 0.5). */
function fitShape(shape: ShapePoint[]): Dot[] {
  const xs = shape.map((p) => p.x);
  const ys = shape.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.14;
  const fit = (v: number, min: number, max: number) => {
    const span = max - min;
    if (span < 0.01) return 0.5;
    return pad + ((v - min) / span) * (1 - 2 * pad);
  };
  return shape.map((p, i) => ({
    x: fit(p.x, minX, maxX),
    y: fit(p.y, minY, maxY),
    color: DOT_COLORS[i % DOT_COLORS.length],
    boss: p.boss,
  }));
}

function makeDots(seed: number, count: number): Dot[] {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
  const out: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = Math.max(
      0.1,
      Math.min(0.9, 0.14 + 0.72 * t + 0.16 * Math.sin(t * Math.PI * 1.7 + seed))
    );
    const y = Math.max(0.12, Math.min(0.88, 0.2 + 0.6 * t + (rnd() - 0.5) * 0.22));
    out.push({
      x,
      y,
      color: DOT_COLORS[(seed + i) % DOT_COLORS.length],
      boss: i === count - 1 || (count > 6 && i === Math.floor(count * 0.45)),
    });
  }
  return out;
}

function RouteMiniMap({
  seed,
  count,
  shape,
  w = 124,
  h = 80,
}: {
  seed: number;
  count: number;
  /** Real pull centroids (route order). When present, the actual route is drawn. */
  shape?: ShapePoint[];
  w?: number;
  h?: number;
}) {
  const dots =
    shape && shape.length ? fitShape(shape) : makeDots(seed, Math.max(1, Math.min(count, 11)));
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 8,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'radial-gradient(130% 120% at 30% 20%, #2a2a28 0%, #1c1c1b 55%, #161615 100%)',
        border: `1px solid ${T.borderHi}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.4,
          backgroundImage: `linear-gradient(${T.faint} 1px, transparent 1px), linear-gradient(90deg, ${T.faint} 1px, transparent 1px)`,
          backgroundSize: '18px 18px',
        }}
      />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <polyline
          points={dots.map((d) => `${d.x * 100},${d.y * 100}`).join(' ')}
          fill="none"
          stroke={T.gold}
          strokeWidth="0.9"
          strokeDasharray="1.4 2.4"
          strokeLinecap="round"
          opacity="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {dots.map((d, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${d.x * 100}%`,
            top: `${d.y * 100}%`,
            transform: 'translate(-50%,-50%)',
            width: d.boss ? 9 : 7,
            height: d.boss ? 9 : 7,
            borderRadius: '50%',
            background: d.color,
            border: d.boss ? `1.5px solid ${T.boss}` : '1.4px solid rgba(255,255,255,0.85)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        />
      ))}
    </div>
  );
}

// Props are stable primitives (seed/count from the row's useMemo), so memoizing
// skips the seeded-scatter recompute on every row hover and stepper click.
export default memo(RouteMiniMap);
