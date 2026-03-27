'use client';

import { useEffect, useState } from 'react';
import DpsHeroCard from './DpsHeroCard';

interface Ability {
  name: string;
  portion_dps: number;
  school: string;
  spell_id?: number;
}

interface ResultsChartProps {
  dps: number;
  dpsError: number;
  dpsErrorPct?: number;
  fightLength: number;
  playerName: string;
  playerClass: string;
  abilities: Ability[];
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
}

const iconCache = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !iconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(iconCache));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.icon) iconCache.set(id, data.icon);
        } catch {
          // ignore
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(iconCache));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

function SpellIcon({ icon }: { icon: string }) {
  return (
    <img
      src={`https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`}
      alt=""
      className="h-5 w-5 shrink-0 rounded-[3px]"
    />
  );
}

const SCHOOL_COLORS: Record<string, string> = {
  physical: '#D4A843',
  holy: '#F5E6A3',
  fire: '#EF6461',
  nature: '#6BCB77',
  frost: '#6CB4EE',
  shadow: '#B07CD8',
  arcane: '#E88AED',
};

export default function ResultsChart({
  dps,
  dpsError,
  dpsErrorPct,
  fightLength,
  playerName,
  playerClass,
  abilities,
  desiredTargets,
  iterations,
  targetError,
  elapsedTime,
}: ResultsChartProps) {
  const totalDps = dps || abilities.reduce((s, a) => s + a.portion_dps, 0);
  const top = abilities.slice(0, 15);
  const maxDps = top.length > 0 ? top[0].portion_dps : 1;
  const spellIds = top.map((a) => a.spell_id || 0);
  const icons = useSpellIcons(spellIds);

  return (
    <div className="space-y-6">
      <DpsHeroCard
        playerName={playerName}
        playerClass={playerClass}
        dps={dps}
        dpsError={dpsError}
        dpsErrorPct={dpsErrorPct}
        fightLength={fightLength}
        desiredTargets={desiredTargets}
        iterations={iterations}
        targetError={targetError}
        elapsedTime={elapsedTime}
      />

      <div className="card p-5">
        <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
          Damage Breakdown
        </h3>
        <div className="space-y-1">
          {top.map((a, i) => {
            const color = SCHOOL_COLORS[a.school] || SCHOOL_COLORS.physical;
            const pct = totalDps > 0 ? (a.portion_dps / totalDps) * 100 : 0;
            const barWidth = maxDps > 0 ? (a.portion_dps / maxDps) * 100 : 0;
            const name = a.name.replace(/_/g, ' ');

            return (
              <div key={i} className="group relative flex h-7 items-center">
                {/* Background bar */}
                <div
                  className="absolute inset-y-0 left-0 rounded-r opacity-[0.08] transition-opacity group-hover:opacity-[0.14]"
                  style={{ width: `${barWidth}%`, backgroundColor: color }}
                />
                {/* Left edge accent */}
                <div
                  className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full"
                  style={{ backgroundColor: color, opacity: 0.6 }}
                />
                {/* Content */}
                <span className="relative flex flex-1 items-center gap-2 truncate pl-3 text-[12px] text-gray-300">
                  {a.spell_id && icons.get(a.spell_id) ? (
                    <SpellIcon icon={icons.get(a.spell_id)!} />
                  ) : (
                    <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface-2" />
                  )}
                  {name}
                </span>
                <span className="relative w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-500">
                  {Math.round(a.portion_dps).toLocaleString()}
                </span>
                <span className="relative w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-500">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
