'use client';

import { useState } from 'react';
import { T } from './routeTheme';
import { IBoss } from './routeIcons';
import type { DerivedPull } from './useRouteEditor';

interface NodeProps {
  p: DerivedPull;
  selected: boolean;
  picked: boolean;
  last: boolean;
  onClick: (n: number) => void;
}

function TimelineNode({ p, selected, picked, last, onClick }: NodeProps) {
  const [h, setH] = useState(false);
  const accent = picked ? T.picked : T.gold;
  return (
    <div
      onClick={() => onClick(p.n)}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{ position: 'relative', display: 'flex', gap: 13, padding: '0 16px 0 0', cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', width: 34, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {!last && (
          <div
            style={{
              position: 'absolute',
              top: 14,
              bottom: -14,
              left: '50%',
              width: 2,
              transform: 'translateX(-50%)',
              background: T.gold,
              opacity: 0.5,
            }}
          />
        )}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: `#${p.color}`,
            marginTop: 1,
            border: selected || picked ? `2.5px solid ${accent}` : '2px solid rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 800,
            color: '#fff',
            boxShadow: selected || picked ? `0 0 8px ${accent}` : '0 1px 3px rgba(0,0,0,0.5)',
            transition: 'all .12s',
          }}
        >
          {p.n}
        </div>
      </div>
      <div style={{ flex: 1, paddingBottom: 16, minWidth: 0 }}>
        <div
          style={{
            borderRadius: 7,
            padding: '8px 11px',
            background: picked
              ? 'rgba(95,191,255,0.12)'
              : selected
                ? T.goldSub
                : h
                  ? 'rgba(255,255,255,0.03)'
                  : T.surface,
            border: `1px solid ${picked ? 'rgba(95,191,255,0.4)' : selected ? T.goldBord : T.border}`,
            transition: 'all .1s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              Pull {p.n}
              {p.boss && (
                <span style={{ display: 'flex', color: T.boss }}>
                  <IBoss s={11} />
                </span>
              )}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.gold, fontVariantNumeric: 'tabular-nums' }}>
              {p.forces}%
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span style={{ fontSize: 10, color: T.muted, whiteSpace: 'nowrap' }}>
              {p.mobs} {p.mobs === 1 ? 'mob' : 'mobs'}
            </span>
            <div style={{ flex: 1, height: 3, background: T.faint, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, p.forces)}%`, height: '100%', background: `#${p.color}`, opacity: 0.85 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ForcesTimelineProps {
  pulls: DerivedPull[];
  enemyCount: number;
  coveragePct: number;
  selected: number | null;
  pick: number[];
  onSelect: (n: number) => void;
}

export default function ForcesTimeline({
  pulls,
  enemyCount,
  coveragePct,
  selected,
  pick,
  onSelect,
}: ForcesTimelineProps) {
  const shown = Math.round(coveragePct);
  return (
    <div
      style={{
        width: 288,
        background: T.panel,
        borderLeft: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
      }}
    >
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 9 }}>Route progression</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 9 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: T.gold, lineHeight: 1 }}>
            {shown}
            <span style={{ fontSize: 15 }}>%</span>
          </span>
          <span style={{ fontSize: 11, color: T.muted }}>{enemyCount} enemy forces</span>
        </div>
        <div style={{ height: 7, background: T.faint, borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(100, coveragePct)}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${T.goldDim}, ${T.gold})`,
              borderRadius: 4,
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0 8px' }}>
        {pulls.map((p, i) => (
          <TimelineNode
            key={p.n}
            p={p}
            selected={selected === p.n}
            picked={pick.includes(p.n)}
            last={i === pulls.length - 1}
            onClick={onSelect}
          />
        ))}
        {pulls.length === 0 && (
          <div style={{ padding: '8px 18px', fontSize: 11, color: T.muted }}>Geen pulls.</div>
        )}
      </div>
    </div>
  );
}
