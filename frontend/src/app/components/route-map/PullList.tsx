'use client';

import type { MdtMapPull } from '../../lib/api';

interface PullListProps {
  pulls: MdtMapPull[];
  selectedPull: number | null;
  onSelectPull: (pull: number | null) => void;
}

export default function PullList({ pulls, selectedPull, onSelectPull }: PullListProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="border-b border-outline-variant/10 px-4 py-3 text-sm font-medium text-on-surface-variant">
        Pulls ({pulls.length})
      </div>
      <ul className="flex-1 divide-y divide-outline-variant/5">
        {pulls.map((pull) => {
          const forces = pull.enemies.reduce((sum, e) => sum + e.count, 0);
          const bosses = pull.enemies.filter((e) => e.is_boss).length;
          const selected = selectedPull === pull.index;
          return (
            <li key={pull.index}>
              <button
                type="button"
                onClick={() => onSelectPull(selected ? null : pull.index)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  selected ? 'bg-gold/[0.08]' : 'hover:bg-surface-container-high'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/40"
                  style={{ backgroundColor: `#${pull.color}` }}
                />
                <span className="w-14 shrink-0 text-sm font-medium text-on-surface">
                  Pull {pull.index}
                </span>
                <span className="flex-1 text-[13px] text-on-surface-variant/70">
                  {pull.enemies.length} mobs
                  {bosses > 0 && <span className="ml-1 text-gold">· {bosses} boss</span>}
                </span>
                <span className="shrink-0 font-mono text-[13px] tabular-nums text-on-surface-variant/60">
                  {forces}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
