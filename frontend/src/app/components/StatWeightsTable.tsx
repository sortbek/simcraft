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

export default function StatWeightsTable({ statWeights }: StatWeightsTableProps) {
  const entries = Object.entries(statWeights)
    .map(([key, value]) => ({
      stat: STAT_DISPLAY_NAMES[key] || key.replace(/_/g, ' '),
      weight: value,
    }))
    .sort((a, b) => b.weight - a.weight);

  const maxWeight = entries.length > 0 ? entries[0].weight : 1;

  return (
    <div className="card p-5">
      <h3 className="mb-5 text-xs font-medium uppercase tracking-widest text-muted">
        Stat Weights
      </h3>
      <div className="space-y-3">
        {entries.map(({ stat, weight }) => (
          <div key={stat}>
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="text-gray-300">{stat}</span>
              <span className="font-mono tabular-nums text-white">{weight.toFixed(4)}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-gold/70 transition-all"
                style={{ width: `${(weight / maxWeight) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
