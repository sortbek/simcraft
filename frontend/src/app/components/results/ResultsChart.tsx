'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';

interface Ability {
  name: string;
  portion_dps: number;
  school: string;
  spell_id?: number;
  children?: Ability[];
}

interface ResultsChartProps {
  dps: number;
  abilities: Ability[];
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

// Hardcoded icons for abilities that lack a spell_id (e.g. auto_attack id=0)
const FALLBACK_ICONS: Record<string, string> = {
  auto_attack: 'inv_sword_04',
};

const SCHOOL_COLORS: Record<string, string> = {
  physical: '#D4A843',
  holy: '#F5E6A3',
  fire: '#EF6461',
  nature: '#6BCB77',
  frost: '#6CB4EE',
  shadow: '#B07CD8',
  arcane: '#E88AED',
};

function formatDps(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toLocaleString();
}

export default function ResultsChart({ dps, abilities }: ResultsChartProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const totalDps = dps || abilities.reduce((s, a) => s + a.portion_dps, 0);
  const top = abilities.slice(0, 15);
  const maxDps = top.length > 0 ? top[0].portion_dps : 1;
  const spellIds = top.flatMap((a) => [
    a.spell_id || 0,
    ...(a.children?.map((c) => c.spell_id || 0) ?? []),
  ]);
  const icons = useSpellIcons(spellIds);

  return (
    <div className="bg-surface-container-low rounded-xl p-8 border border-outline-variant/10">
      <h3 className="font-headline font-black text-sm uppercase tracking-widest text-on-surface-variant mb-8 border-b border-outline-variant/10 pb-4">
        {t('results.damageBreakdown')}
      </h3>
      <div className="space-y-4">
        {top.map((a, i) => {
          const color = SCHOOL_COLORS[a.school] || SCHOOL_COLORS.physical;
          const pct = totalDps > 0 ? (a.portion_dps / totalDps) * 100 : 0;
          const barWidth = maxDps > 0 ? (a.portion_dps / maxDps) * 100 : 0;
          const name = a.name.replace(/_/g, ' ');
          const hasChildren = a.children && a.children.length > 0;
          const isOpen = expanded.has(i);

          return (
            <div key={i}>
              <div
                className={`flex items-center gap-4${hasChildren ? ' cursor-pointer' : ''}`}
                onClick={
                  hasChildren
                    ? () =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                    : undefined
                }
              >
                {hasChildren && (
                  <svg
                    className={`h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <div className="w-10 h-10 bg-surface-container-highest rounded border border-outline-variant flex items-center justify-center shrink-0 overflow-hidden">
                  {a.spell_id && icons.get(a.spell_id) ? (
                    <img
                      src={`https://wow.zamimg.com/images/wow/icons/small/${icons.get(a.spell_id)}.jpg`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : FALLBACK_ICONS[a.name] ? (
                    <img
                      src={`https://wow.zamimg.com/images/wow/icons/small/${FALLBACK_ICONS[a.name]}.jpg`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-surface-container-highest" />
                  )}
                </div>
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex justify-between items-end text-xs font-bold uppercase">
                    <span className="truncate">{name}</span>
                    <span className={i === 0 ? 'text-primary' : 'text-on-surface'}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-6 w-full bg-surface-container-highest/30 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${barWidth}%`,
                        background: `linear-gradient(90deg, ${color} 0%, transparent 100%)`,
                      }}
                    />
                  </div>
                </div>
                <div className="w-24 text-right shrink-0">
                  <span className="font-headline font-bold text-sm text-on-surface">
                    {formatDps(a.portion_dps)}
                  </span>
                  <span className="text-[10px] block opacity-50 uppercase">DPS</span>
                </div>
              </div>
              {isOpen &&
                a.children?.map((child, ci) => {
                  const childColor = SCHOOL_COLORS[child.school] || SCHOOL_COLORS.physical;
                  const childPct = totalDps > 0 ? (child.portion_dps / totalDps) * 100 : 0;
                  const childBarWidth = maxDps > 0 ? (child.portion_dps / maxDps) * 100 : 0;
                  const childName = child.name.replace(/_/g, ' ');
                  return (
                    <div key={ci} className="flex items-center gap-4 pl-14 opacity-75 mt-2">
                      <div className="w-8 h-8 bg-surface-container-highest rounded border border-outline-variant flex items-center justify-center shrink-0 overflow-hidden">
                        {child.spell_id && icons.get(child.spell_id) ? (
                          <img
                            src={`https://wow.zamimg.com/images/wow/icons/small/${icons.get(child.spell_id)}.jpg`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-container-highest" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex justify-between items-end text-[11px] font-bold uppercase text-on-surface-variant/60">
                          <span className="truncate">{childName}</span>
                          <span>{childPct.toFixed(1)}%</span>
                        </div>
                        <div className="h-4 w-full bg-surface-container-highest/30 rounded overflow-hidden">
                          <div
                            className="h-full rounded transition-all"
                            style={{
                              width: `${childBarWidth}%`,
                              background: `linear-gradient(90deg, ${childColor} 0%, transparent 100%)`,
                              opacity: 0.7,
                            }}
                          />
                        </div>
                      </div>
                      <div className="w-24 text-right shrink-0">
                        <span className="font-headline font-bold text-xs text-on-surface-variant">
                          {formatDps(child.portion_dps)}
                        </span>
                        <span className="text-[9px] block opacity-40 uppercase">DPS</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
