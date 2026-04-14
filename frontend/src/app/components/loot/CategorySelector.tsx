import { useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { DungeonCategory } from '../../lib/types';

interface CategoryTab {
  key: string;
  label: string;
  icon: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  raids: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
  mplus: 'M8 1v14M1 8h14M4 4l8 8M12 4l-8 8',
  crafted: 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3',
  delves: 'M8 1L1 6v4l7 5 7-5V6L8 1zM1 6l7 5 7-5',
  prey: 'M8 2L3 5v6l5 3 5-3V5L8 2zM8 8V2M8 8l5-3M8 8l-5-3',
  catalyst: 'M8 1a7 7 0 100 14A7 7 0 008 1zM5 8h6M8 5v6',
  'rare-profession': 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3',
  'pvp-profession': 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3',
};

const DEFAULT_ICON = 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3';

function getIcon(key: string): string {
  if (CATEGORY_ICONS[key]) return CATEGORY_ICONS[key];
  if (key.startsWith('pvp')) return 'M8 1l2 3h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z';
  return DEFAULT_ICON;
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
      { key: 'raids', label: t('loot.raids'), icon: CATEGORY_ICONS.raids },
    ];
    for (const dc of dungeonCats) {
      result.push({ key: dc.cat.key, label: dc.cat.label, icon: getIcon(dc.cat.key) });
    }
    return result;
  }, [dungeonCats, t]);

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {tabs.map((cat) => {
        const isActive = category === cat.key;
        return (
          <button
            key={cat.key}
            onClick={() => onChange(cat.key)}
            className={`group relative rounded-xl px-4 py-3.5 text-left transition-all duration-200 ${
              isActive
                ? 'bg-surface-container shadow-glow'
                : 'bg-surface-container-low hover:bg-surface-container-high'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isActive ? 'bg-gold/20' : 'bg-gold/[0.06] group-hover:bg-gold/[0.12]'
                }`}
              >
                <svg
                  className={`h-4 w-4 transition-colors ${isActive ? 'text-gold' : 'text-gold/50 group-hover:text-gold'}`}
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
              <span
                className={`text-sm font-semibold transition-colors ${
                  isActive ? 'text-gold' : 'text-on-surface group-hover:text-white'
                }`}
              >
                {cat.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
