'use client';
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import CardHeader from '../ui/CardHeader';
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
    <section className="card">
      <CardHeader title={t('results.damageBreakdown')} />
      <div className="px-6 py-2.5 [&>*+*]:border-t [&>*+*]:border-line/[0.06]">
        {top.map((ability, index) => {
          const percent = totalDps > 0 ? (ability.portion_dps / totalDps) * 100 : 0;
          const barWidth = maxDps > 0 ? (ability.portion_dps / maxDps) * 100 : 0;
          const hasChildren = !!ability.children?.length;
          const isOpen = expanded.has(index);

          return (
            <div key={index}>
              <ResultsChartRow
                ability={ability}
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
                  const childPercent = totalDps > 0 ? (child.portion_dps / totalDps) * 100 : 0;
                  const childBarWidth = maxDps > 0 ? (child.portion_dps / maxDps) * 100 : 0;
                  return (
                    <ResultsChartRow
                      key={childIndex}
                      ability={child}
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
    </section>
  );
}
