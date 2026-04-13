import { useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { DungeonCategory } from '../../lib/types';

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
    const result = [{ key: 'raids', label: t('loot.raids') }];
    for (const dc of dungeonCats) {
      result.push({ key: dc.cat.key, label: dc.cat.label });
    }
    return result;
  }, [dungeonCats, t]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((cat) => (
        <button
          key={cat.key}
          onClick={() => onChange(cat.key)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
            category === cat.key
              ? 'border-gold/40 bg-gold/[0.08] text-gold'
              : 'border-transparent bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
