'use client';

interface StatWeightsTableProps {
  statWeights: Record<string, number>;
}

const STAT_DISPLAY_NAMES: Record<string, string> = {
  intellect: 'Intellect',
  strength: 'Strength',
  agility: 'Agility',
  stamina: 'Stamina',
  crit_rating: 'Critical Strike',
  haste_rating: 'Haste',
  mastery_rating: 'Mastery',
  versatility_rating: 'Versatility',
  weapon_dps: 'Weapon DPS',
};

const BAR_COLORS = [
  'bg-primary',
  'bg-primary-container',
  'bg-on-surface-variant',
  'bg-on-surface-variant opacity-40',
  'bg-on-surface-variant opacity-40',
];

export default function StatWeightsTable({ statWeights }: StatWeightsTableProps) {
  const entries = Object.entries(statWeights)
    .map(([key, value]) => ({
      stat: STAT_DISPLAY_NAMES[key] || key.replace(/_/g, ' '),
      weight: value,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = entries.length > 0 ? entries[0].weight : 1;

  return (
    <div className="bg-surface-container-low rounded-xl p-8 border border-outline-variant/10">
      <h3 className="font-headline font-black text-sm uppercase tracking-widest text-on-surface-variant mb-6">
        Stat Weights
      </h3>
      <div className="space-y-6">
        {entries.map(({ stat, weight }, i) => (
          <div key={stat} className="flex flex-col gap-2">
            <div className="flex justify-between text-xs font-headline font-bold uppercase tracking-tight">
              <span>{stat}</span>
              <span className={i === 0 ? 'text-primary' : 'text-on-surface'}>
                {weight.toFixed(2)}
              </span>
            </div>
            <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]}`}
                style={{ width: `${(weight / maxWeight) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
