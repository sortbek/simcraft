'use client';
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import ResultsChartRow from './ResultsChartRow';
import { useSpellIcons } from './useSpellIcons';

interface Ability {
  name: string;
  portion_dps: number;
  school: string;
  spell_id?: number;
  icon?: string;
  children?: Ability[];
}

interface ResultsChartProps {
  dps: number;
  abilities: Ability[];
}

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

export default function ResultsChart({ dps, abilities }: ResultsChartProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const totalDps = dps || abilities.reduce((sum, ability) => sum + ability.portion_dps, 0);
  const top = abilities.slice(0, 15);
  const maxDps = top.length > 0 ? top[0].portion_dps : 1;
  const spellIds = top.flatMap((ability) => [
    ability.spell_id || 0,
    ...(ability.children?.map((child) => child.spell_id || 0) ?? []),
  ]);
  const icons = useSpellIcons(spellIds);

  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-8">
      <h3 className="mb-8 border-b border-outline-variant/10 pb-4 font-headline text-sm font-black uppercase tracking-widest text-on-surface-variant">
        {t('results.damageBreakdown')}
      </h3>
      <div className="space-y-4">
        {top.map((ability, index) => {
          const color = SCHOOL_COLORS[ability.school] || SCHOOL_COLORS.physical;
          const percent = totalDps > 0 ? (ability.portion_dps / totalDps) * 100 : 0;
          const barWidth = maxDps > 0 ? (ability.portion_dps / maxDps) * 100 : 0;
          const hasChildren = !!ability.children?.length;
          const isOpen = expanded.has(index);

          return (
            <div key={index}>
              <ResultsChartRow
                ability={ability}
                color={color}
                percent={percent}
                barWidth={barWidth}
                iconName={
                  ability.icon ||
                  (ability.spell_id ? icons.get(ability.spell_id) : undefined) ||
                  FALLBACK_ICONS[ability.name]
                }
                expandable={hasChildren}
                expanded={isOpen}
                onToggle={
                  hasChildren
                    ? () =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                    : undefined
                }
              />
              {isOpen &&
                ability.children?.map((child, childIndex) => {
                  const childColor = SCHOOL_COLORS[child.school] || SCHOOL_COLORS.physical;
                  const childPercent = totalDps > 0 ? (child.portion_dps / totalDps) * 100 : 0;
                  const childBarWidth = maxDps > 0 ? (child.portion_dps / maxDps) * 100 : 0;
                  return (
                    <ResultsChartRow
                      key={childIndex}
                      ability={child}
                      color={childColor}
                      percent={childPercent}
                      barWidth={childBarWidth}
                      iconName={
                        child.icon || (child.spell_id ? icons.get(child.spell_id) : undefined)
                      }
                      compact
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
