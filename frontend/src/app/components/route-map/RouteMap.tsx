'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, type MdtMap, type MdtMapMarker } from '../../lib/api';

// MDT composites maps as a 15x10 grid of 128px tiles -> 1920x1280 native image.
// Mob coordinates are in MDT's 840x560 base space; plot at (x*S, -y*S).
const MAP_W = 1920;
const MAP_H = 1280;
const SCALE_X = MAP_W / 840;
const SCALE_Y = MAP_H / 560;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

interface RouteMapProps {
  map: MdtMap;
  selectedPull: number | null;
  onSelectPull: (pull: number | null) => void;
}

interface HoverState {
  marker: MdtMapMarker;
  pull: number;
  /** Marker center in stage (native-image) pixels. */
  sx: number;
  sy: number;
}

function markerDiameter(m: MdtMapMarker): number {
  return 18 * (m.scale || 1) * (m.is_boss ? 1.6 : 1);
}

export default function RouteMap({ map, selectedPull, onSelectPull }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sublevel, setSublevel] = useState(map.sublevels[0]?.index ?? 1);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Fit the whole map into the container on mount and when the dungeon changes.
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const z = Math.min(width / MAP_W, height / MAP_H);
    setZoom(z);
    setPan({ x: (width - MAP_W * z) / 2, y: (height - MAP_H * z) / 2 });
  }, []);

  useEffect(() => {
    fit();
  }, [fit, map.dungeon_idx]);

  // Wheel zoom around the cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
        setPan((p) => ({
          x: mx - ((mx - p.x) * nz) / z,
          y: my - ((my - p.y) * nz) / z,
        }));
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag to pan.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const visiblePulls = map.pulls
    .map((pull) => ({
      ...pull,
      enemies: pull.enemies.filter((e) => e.sublevel === sublevel),
    }))
    .filter((pull) => pull.enemies.length > 0);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-outline-variant/20 bg-black/40">
      {map.sublevels.length > 1 && (
        <div className="absolute left-3 top-3 z-20 flex gap-1 rounded-lg bg-surface-container-high/90 p-1 backdrop-blur">
          {map.sublevels.map((s) => (
            <button
              key={s.index}
              type="button"
              onClick={() => setSublevel(s.index)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                s.index === sublevel
                  ? 'bg-gold/15 text-gold'
                  : 'text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={fit}
        className="absolute right-3 top-3 z-20 rounded-lg bg-surface-container-high/90 px-2.5 py-1 text-[13px] text-on-surface-variant backdrop-blur transition-colors hover:text-on-surface"
      >
        Reset view
      </button>

      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left select-none"
          style={{
            width: MAP_W,
            height: MAP_H,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={apiUrl(`/api/data/mdt-maps/${map.dungeon_idx}_${sublevel}.png`)}
            alt=""
            width={MAP_W}
            height={MAP_H}
            draggable={false}
            className="pointer-events-none absolute left-0 top-0"
          />

          {visiblePulls.map((pull) =>
            pull.enemies.map((m, i) => {
              const d = markerDiameter(m);
              const sx = m.x * SCALE_X;
              const sy = -m.y * SCALE_Y;
              const dim = selectedPull !== null && selectedPull !== pull.index;
              return (
                <div
                  key={`${pull.index}-${i}`}
                  onMouseEnter={() => setHover({ marker: m, pull: pull.index, sx, sy })}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPull(selectedPull === pull.index ? null : pull.index);
                  }}
                  className="absolute rounded-full border transition-opacity"
                  style={{
                    left: sx - d / 2,
                    top: sy - d / 2,
                    width: d,
                    height: d,
                    backgroundColor: `#${pull.color}`,
                    borderColor: m.is_boss ? '#ffd700' : 'rgba(0,0,0,0.6)',
                    borderWidth: m.is_boss ? 2 : 1,
                    opacity: dim ? 0.25 : 1,
                    cursor: 'pointer',
                  }}
                />
              );
            })
          )}
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute z-30 rounded-md bg-surface-container-highest/95 px-2 py-1 text-[12px] text-on-surface shadow-lg backdrop-blur"
            style={{
              left: pan.x + hover.sx * zoom + 10,
              top: pan.y + hover.sy * zoom + 10,
            }}
          >
            <div className="font-medium">
              {hover.marker.is_boss ? '★ ' : ''}
              {hover.marker.name}
            </div>
            <div className="text-on-surface-variant/70">
              Pull {hover.pull} · {hover.marker.count} forces
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
