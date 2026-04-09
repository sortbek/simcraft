import { useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { DungeonCategory } from '../../lib/types';

interface CategoryTab {
  key: string;
  label: string;
  icon: string;
}

interface CategorySelectorProps {
  category: string;
  onChange: (key: string) => void;
  dungeonCats: { cat: DungeonCategory; instances: unknown[] }[];
}

export default function CategorySelector({
  category,
  onChange,
  dungeonCats,
}: CategorySelectorProps) {
  const { t } = useLanguage();
  const tabs = useMemo(() => {
    const result: CategoryTab[] = [
      {
        key: 'raids',
        label: t('loot.raids'),
        icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
      },
    ];
    for (const dc of dungeonCats) {
      let icon: string;
      if (dc.cat.key === 'mplus') {
        icon = 'M8 1v14M1 8h14M4 4l8 8M12 4l-8 8';
      } else if (dc.cat.key === 'crafted') {
        icon = 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3';
      } else {
        icon = 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3';
      }
      result.push({ key: dc.cat.key, label: dc.cat.label, icon });
    }
    return result;
  }, [dungeonCats, t]);

  return (
    <div className="grid grid-cols-3 gap-3">
      {tabs.map((cat) => (
        <button
          key={cat.key}
          onClick={() => onChange(cat.key)}
          className={`card p-4 text-center transition-all ${category === cat.key ? 'border-gold/50 bg-gold/[0.03]' : 'hover:border-gold/20'}`}
        >
          <div
            className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${category === cat.key ? 'bg-primary/20' : 'bg-primary/10'}`}
          >
            <svg
              className="h-5 w-5 text-gold"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={cat.icon} />
            </svg>
          </div>
          <p
            className={`text-[15px] font-semibold transition-colors ${category === cat.key ? 'text-primary' : 'text-on-surface'}`}
          >
            {cat.label}
          </p>
        </button>
      ))}
    </div>
  );
}
