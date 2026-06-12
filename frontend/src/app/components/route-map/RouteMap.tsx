'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, type MdtMap, type MdtMapEnemy } from '../../lib/api';
import { T, DEFAULT_PULL_COLOR } from './routeTheme';
import { IBoss, IPlus, IMinus } from './routeIcons';
import { ModeBanner } from './RouteOverlays';
import type { RouteEditor } from './useRouteEditor';

// MDT composites maps as a 15x10 grid of 128px tiles -> 1920x1280 native image.
// Mob coordinates are in MDT's 840x560 base space; plot at (x*S, -y*S).
const MAP_W = 1920;
const MAP_H = 1280;
const SCALE_X = MAP_W / 840;
const SCALE_Y = MAP_H / 560;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const BADGE = 26;
const UNPULLED_COLOR = 'rgba(120,122,132,0.82)';

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
function markerDiameter(m: MdtMapEnemy): number {
  return 20 * (m.scale || 1) * (m.is_boss ? 1.9 : 1);
}
function formatHp(h: number): string {
  if (h >= 1_000_000) return `${(h / 1_000_000).toFixed(1)}M`;
  if (h >= 1_000) return `${Math.round(h / 1000)}k`;
  return String(h);
}

interface HoverState {
  enemy: MdtMapEnemy;
  pull: number | null;
  sx: number;
  sy: number;
}

export default function RouteMap({ editor, map }: { editor: RouteEditor; map: MdtMap }) {
  const { enemies, assignment, pulls, selected, mode, pick, draft } = editor;
  const containerRef = useRef<HTMLDivElement>(null);
  const [sublevel, setSublevel] = useState(map.sublevels[0]?.index ?? 1);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;
  const fittedRef = useRef(true);
  const fitZoomRef = useRef(0.5);
  // Lasso rectangle (container-space) while drawing a new pull.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const [lasso, setLasso] = useState<Box | null>(null);
  const lassoRef = useRef<Box | null>(null);
  const liveRef = useRef({ assignment, sublevel, enemies });
  liveRef.current = { assignment, sublevel, enemies };
  const finalizeRef = useRef<(box: Box) => void>(() => {});

  // Cover-fill the viewport with the map and center it.
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const z = Math.max(width / MAP_W, height / MAP_H);
    setZoom(z);
    setPan({ x: (width - MAP_W * z) / 2, y: (height - MAP_H * z) / 2 });
    fitZoomRef.current = z;
    fittedRef.current = true;
  }, []);

  useEffect(() => {
    fit();
  }, [fit, map.dungeon_idx]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (fittedRef.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAround = useCallback((factor: number, ax?: number, ay?: number) => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const mx = ax ?? width / 2;
    const my = ay ?? height / 2;
    const z = zoomRef.current;
    const nz = clampZoom(z * factor);
    if (nz === z) return;
    const p = panRef.current;
    setZoom(nz);
    setPan({ x: mx - ((mx - p.x) * nz) / z, y: my - ((my - p.y) * nz) / z });
    fittedRef.current = false;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (lassoRef.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const box = { ...lassoRef.current, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
        lassoRef.current = box;
        movedRef.current = true;
        setLasso(box);
        return;
      }
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (dx !== 0 || dy !== 0) {
        movedRef.current = true;
        fittedRef.current = false;
      }
      dragRef.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = () => {
      if (lassoRef.current) {
        finalizeRef.current(lassoRef.current);
        lassoRef.current = null;
        setLasso(null);
        return;
      }
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Frame a pull when it becomes selected (from map or timeline).
  const focusPull = useCallback(
    (n: number) => {
      const p = pulls.find((x) => x.n === n);
      if (!p) return;
      setSublevel(p.sublevel);
      const onSub = p.cloneIdxs.map((i) => enemies[i]).filter((e) => e.sublevel === p.sublevel);
      if (!onSub.length) return;
      const xs = onSub.map((e) => e.x * SCALE_X);
      const ys = onSub.map((e) => -e.y * SCALE_Y);
      const el = containerRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const pad = 170;
      const bw = Math.max(...xs) - Math.min(...xs) + pad * 2;
      const bh = Math.max(...ys) - Math.min(...ys) + pad * 2;
      const z = clampZoom(Math.min(width / bw, height / bh));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      setZoom(z);
      setPan({ x: width / 2 - cx * z, y: height / 2 - cy * z });
      fittedRef.current = false;
    },
    [pulls, enemies]
  );

  useEffect(() => {
    if (selected !== null) focusPull(selected);
  }, [selected, focusPull]);

  const pullColor = useMemo(() => {
    const m: Record<number, string> = {};
    for (const p of pulls) m[p.n] = p.color;
    return m;
  }, [pulls]);

  const visibleIdxs = useMemo(
    () => enemies.map((_, i) => i).filter((i) => enemies[i].sublevel === sublevel),
    [enemies, sublevel]
  );

  const visibleBadges = useMemo(
    () => pulls.filter((p) => p.sublevel === sublevel),
    [pulls, sublevel]
  );

  // Route path: pull centroids in order on this sublevel.
  const pathPoints = useMemo(
    () =>
      visibleBadges
        .slice()
        .sort((a, b) => a.n - b.n)
        .map((p) => `${p.cx * SCALE_X},${-p.cy * SCALE_Y}`)
        .join(' '),
    [visibleBadges]
  );

  const cloneOpacity = (i: number): number => {
    const pull = assignment[i];
    if (mode === 'draw') return pull === null ? (draft.includes(i) ? 1 : 0.9) : 0.22;
    if (selected !== null) return pull === selected || (pull !== null && pick.includes(pull)) ? 1 : 0.12;
    return pull !== null ? 1 : 0.4;
  };

  const onCloneClick = (i: number) => {
    const pull = assignment[i];
    if (mode === 'draw') {
      editor.onCloneClick(i);
      return;
    }
    if (pull !== null) editor.onPullClick(pull);
    else if (mode === 'view') editor.setSelected(null);
  };

  const onModeDone = () => (mode === 'draw' ? editor.commitDraw() : editor.endMode());

  // Lasso finalize: add every unpulled clone whose screen position falls inside
  // the rectangle to the draft pull. Tiny boxes are treated as a click (no-op).
  finalizeRef.current = (box: Box) => {
    const minX = Math.min(box.x0, box.x1);
    const maxX = Math.max(box.x0, box.x1);
    const minY = Math.min(box.y0, box.y1);
    const maxY = Math.max(box.y0, box.y1);
    if (maxX - minX < 4 && maxY - minY < 4) return;
    const { assignment: asg, sublevel: sub, enemies: ens } = liveRef.current;
    const z = zoomRef.current;
    const p = panRef.current;
    const sel: number[] = [];
    ens.forEach((e, i) => {
      if (asg[i] !== null || e.sublevel !== sub) return;
      const sx = p.x + e.x * SCALE_X * z;
      const sy = p.y + -e.y * SCALE_Y * z;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) sel.push(i);
    });
    if (sel.length) editor.addToDraft(sel);
  };

  const zoomPct = Math.round((zoom / fitZoomRef.current) * 100);

  const patrolPoints = (e: MdtMapEnemy): string =>
    [{ x: e.x, y: e.y }, ...e.patrol].map((p) => `${p.x * SCALE_X},${-p.y * SCALE_Y}`).join(' ');

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 8,
        border: `1px solid ${T.borderHi}`,
        background: '#0c0c0c',
      }}
    >
      {mode !== 'view' && (
        <ModeBanner mode={mode} pickCount={pick.length} draftCount={draft.length} onDone={onModeDone} />
      )}

      <div
        ref={containerRef}
        style={{ height: '100%', width: '100%', cursor: mode === 'draw' ? 'crosshair' : dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={(e) => {
          movedRef.current = false;
          if (mode === 'draw') {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const box = { x0: x, y0: y, x1: x, y1: y };
            lassoRef.current = box;
            setLasso(box);
          } else {
            dragRef.current = { x: e.clientX, y: e.clientY };
          }
        }}
        onClick={() => {
          if (!movedRef.current && mode === 'view') editor.setSelected(null);
        }}
        onDoubleClick={(e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          zoomAround(1.5, e.clientX - rect.left, e.clientY - rect.top);
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: 'top left',
            userSelect: 'none',
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
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          />

          {/* Route path + patrols */}
          <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} width={MAP_W} height={MAP_H}>
            {visibleIdxs.map((i) =>
              enemies[i].patrol.length > 0 ? (
                <polyline
                  key={`pat-${i}`}
                  points={patrolPoints(enemies[i])}
                  fill="none"
                  stroke={assignment[i] !== null ? `#${pullColor[assignment[i]!] ?? DEFAULT_PULL_COLOR}` : UNPULLED_COLOR}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  opacity={cloneOpacity(i)}
                />
              ) : null
            )}
            {pathPoints && (
              <polyline
                points={pathPoints}
                fill="none"
                stroke={T.gold}
                strokeWidth="2"
                strokeDasharray="2 6"
                strokeLinecap="round"
                opacity={0.55}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* Clone markers */}
          {visibleIdxs.map((i) => {
            const e = enemies[i];
            const pull = assignment[i];
            const d = markerDiameter(e);
            const sx = e.x * SCALE_X;
            const sy = -e.y * SCALE_Y;
            const accent = draft.includes(i) || (pull !== null && pick.includes(pull));
            const fill = pull !== null ? `#${pullColor[pull] ?? DEFAULT_PULL_COLOR}` : UNPULLED_COLOR;
            return (
              <div
                key={`mob-${i}`}
                onMouseEnter={() => setHover({ enemy: e, pull, sx, sy })}
                onMouseLeave={() => setHover(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onCloneClick(i);
                }}
                style={{
                  position: 'absolute',
                  left: sx - d / 2,
                  top: sy - d / 2,
                  width: d,
                  height: d,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: fill,
                  border: accent
                    ? `2.5px solid ${T.picked}`
                    : e.is_boss
                      ? '3px solid #ffd700'
                      : '1.5px solid rgba(0,0,0,0.65)',
                  opacity: cloneOpacity(i),
                  boxShadow: accent ? `0 0 7px ${T.picked}` : '0 1px 2px rgba(0,0,0,0.7)',
                  transition: 'opacity .12s',
                  cursor: 'pointer',
                }}
              >
                {e.is_boss && <span style={{ color: '#000', fontSize: d * 0.6, lineHeight: 1 }}>☠</span>}
              </div>
            );
          })}

          {/* Pull-number badges (counter-scaled) */}
          {visibleBadges.map((p) => {
            const accent = pick.includes(p.n) ? T.picked : selected === p.n ? T.gold : null;
            return (
              <button
                key={`badge-${p.n}`}
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (mode !== 'draw') editor.onPullClick(p.n);
                }}
                style={{
                  position: 'absolute',
                  left: p.cx * SCALE_X - BADGE / 2,
                  top: -p.cy * SCALE_Y - BADGE / 2,
                  width: BADGE,
                  height: BADGE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  fontSize: BADGE * 0.46,
                  fontWeight: 800,
                  color: '#fff',
                  background: `#${p.color}`,
                  border: accent ? `2.5px solid ${accent}` : '2px solid rgba(255,255,255,0.9)',
                  boxShadow: accent ? `0 0 8px ${accent}` : '0 1px 3px rgba(0,0,0,0.7)',
                  opacity: selected === null || selected === p.n || pick.includes(p.n) ? 1 : 0.3,
                  transform: `scale(${1 / zoom})`,
                  pointerEvents: mode === 'draw' ? 'none' : 'auto',
                  cursor: 'pointer',
                  textShadow: '0 1px 1px rgba(0,0,0,0.6)',
                }}
              >
                {p.n}
                {p.boss && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 13,
                      height: 13,
                      borderRadius: '50%',
                      background: T.boss,
                      color: '#3a2a08',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1.5px solid #1a1a1a',
                    }}
                  >
                    <IBoss s={8} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {hover && (
          <div
            style={{
              position: 'absolute',
              zIndex: 30,
              left: pan.x + hover.sx * zoom + 12,
              top: pan.y + hover.sy * zoom + 12,
              pointerEvents: 'none',
              borderRadius: 7,
              background: 'rgba(26,26,26,0.96)',
              border: `1px solid ${T.border}`,
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
              padding: '7px 10px',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              {hover.enemy.is_boss && <span style={{ color: T.boss, display: 'flex' }}><IBoss s={11} /></span>}
              {hover.enemy.name}
            </div>
            <div style={{ fontSize: 10.5, color: T.muted, marginTop: 3 }}>
              {hover.pull !== null ? `Pull ${hover.pull}` : 'Not pulled'} · {formatHp(hover.enemy.health)} hp ·{' '}
              {hover.enemy.count} forces
            </div>
          </div>
        )}
      </div>

      {/* Lasso selection rectangle (draw mode) */}
      {lasso && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(lasso.x0, lasso.x1),
            top: Math.min(lasso.y0, lasso.y1),
            width: Math.abs(lasso.x1 - lasso.x0),
            height: Math.abs(lasso.y1 - lasso.y0),
            border: `1px dashed ${T.gold}`,
            background: 'rgba(245,166,35,0.08)',
            zIndex: 25,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Sublevel tabs (only when a dungeon has more than one) */}
      {map.sublevels.length > 1 && (
        <div style={{ position: 'absolute', left: 16, top: 16, zIndex: 20, display: 'flex', gap: 4, background: 'rgba(20,20,20,0.82)', backdropFilter: 'blur(8px)', border: `1px solid ${T.border}`, borderRadius: 7, padding: 3 }}>
          {map.sublevels.map((s) => (
            <button
              key={s.index}
              type="button"
              onClick={() => setSublevel(s.index)}
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                fontSize: 10.5,
                fontFamily: 'inherit',
                cursor: 'pointer',
                border: 'none',
                background: s.index === sublevel ? T.goldSub : 'transparent',
                color: s.index === sublevel ? T.gold : T.text2,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Zoom control (bottom-left) */}
      <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(20,20,20,0.82)', backdropFilter: 'blur(8px)', border: `1px solid ${T.border}`, borderRadius: 7, padding: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
        <button type="button" onClick={() => zoomAround(1 / 1.2)} style={zbtn} title="Zoom out"><IMinus s={12} /></button>
        <button type="button" onClick={fit} style={{ fontSize: 11, color: T.text2, width: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} title="Fit to screen">
          {Number.isFinite(zoomPct) ? `${zoomPct}%` : '100%'}
        </button>
        <button type="button" onClick={() => zoomAround(1.2)} style={zbtn} title="Zoom in"><IPlus s={12} /></button>
      </div>

      {/* Legend (bottom-right) */}
      <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 11px', fontSize: 10, color: T.text2, background: 'rgba(20,20,20,0.82)', backdropFilter: 'blur(8px)', border: `1px solid ${T.border}`, borderRadius: 7, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: T.gold }} /> In pull</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: UNPULLED_COLOR }} /> Not pulled</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ color: T.boss, display: 'flex' }}><IBoss s={11} /></span> Boss</div>
      </div>
    </div>
  );
}

const zbtn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: T.text2,
  cursor: 'pointer',
  borderRadius: 5,
};
