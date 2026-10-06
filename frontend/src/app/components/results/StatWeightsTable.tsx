'use client';

import { useLanguage } from '../../lib/i18n';
import CardHeader from '../ui/CardHeader';

interface StatWeightsTableProps {
  statWeights: Record<string, number>;
}

const STAT_TRANSLATION_KEYS: Record<string, string> = {
  intellect: 'stat.intellect',
  strength: 'stat.strength',
  agility: 'stat.agility',
  stamina: 'stat.stamina',
  crit_rating: 'stat.criticalStrike',
  haste_rating: 'stat.haste',
  mastery_rating: 'stat.mastery',
  versatility_rating: 'stat.versatility',
  weapon_dps: 'stat.weaponDps',
};

export default function StatWeightsTable({ statWeights }: StatWeightsTableProps) {
  const { t } = useLanguage();
  const entries = Object.entries(statWeights)
    .map(([key, value]) => ({
      stat: STAT_TRANSLATION_KEYS[key] ? t(STAT_TRANSLATION_KEYS[key]) : key.replace(/_/g, ' '),
      weight: value,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = entries.length > 0 ? entries[0].weight : 1;

  return (
    <section className="card">
      <CardHeader title={t('results.statWeights')} />
      <div className="px-6 py-[22px] [&>*+*]:border-t [&>*+*]:border-line/[0.06]">
        {entries.map(({ stat, weight }) => (
          <div key={stat} className="grid grid-cols-[1fr_60px] items-center gap-3.5 py-2.5">
            <div className="min-w-0">
              <div className="mb-[7px] truncate font-headline text-xs font-extrabold uppercase tracking-[0.08em]">
                {stat}
              </div>
              <div className="h-1.5 overflow-hidden rounded-[6px] bg-surface-container-highest">
                <div
                  className="h-full rounded-[6px] bg-gradient-to-r from-gold-dark to-gold-fill"
                  style={{ width: `${(weight / maxWeight) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-right font-headline text-[15px] font-extrabold tabular-nums">
              {weight.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
