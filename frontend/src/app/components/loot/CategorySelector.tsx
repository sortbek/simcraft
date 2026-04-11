import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { DungeonCategory } from '../../lib/types';

interface CategoryTab {
  key: string;
  label: string;
  icon: string;
  /** If set, this is a group header with sub-categories */
  children?: CategoryTab[];
}

interface CategorySelectorProps {
  category: string;
  onChange: (key: string) => void;
  dungeonCats: { cat: DungeonCategory; instances: unknown[] }[];
}

const PVP_KEYS = new Set(['pvp-conquest', 'pvp-honor', 'pvp-bloody-tokens', 'pvp-profession']);
const PROFESSION_KEYS = new Set(['crafted', 'rare-profession']);

export default function CategorySelector({
  category,
  onChange,
  dungeonCats,
}: CategorySelectorProps) {
  const { t } = useLanguage();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const tabs = useMemo(() => {
    const pvpChildren: CategoryTab[] = [];
    const profChildren: CategoryTab[] = [];
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
      } else if (dc.cat.key === 'crafted' || dc.cat.key === 'rare-profession') {
        icon = 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3';
      } else if (dc.cat.key === 'delves') {
        icon = 'M8 1L1 6v4l7 5 7-5V6L8 1zM1 6l7 5 7-5';
      } else if (dc.cat.key === 'prey') {
        icon = 'M8 2L3 5v6l5 3 5-3V5L8 2zM8 8V2M8 8l5-3M8 8l-5-3';
      } else if (dc.cat.key.startsWith('pvp')) {
        icon = 'M8 1l2 3h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z';
      } else if (dc.cat.key === 'catalyst') {
        icon = 'M8 1a7 7 0 100 14A7 7 0 008 1zM5 8h6M8 5v6';
      } else {
        icon = 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3';
      }

      const tab: CategoryTab = { key: dc.cat.key, label: dc.cat.label, icon };

      if (PVP_KEYS.has(dc.cat.key)) {
        pvpChildren.push(tab);
      } else if (PROFESSION_KEYS.has(dc.cat.key)) {
        profChildren.push(tab);
      } else {
        result.push(tab);
      }
    }

    if (profChildren.length > 0) {
      result.push({
        key: '_professions',
        label: 'Professions',
        icon: 'M4 1l4 5 4-5M3 6h10l-1 5H4L3 6zM5 11v3h6v-3',
        children: profChildren,
      });
    }
    if (pvpChildren.length > 0) {
      result.push({
        key: '_pvp',
        label: 'PVP',
        icon: 'M8 1l2 3h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z',
        children: pvpChildren,
      });
    }

    return result;
  }, [dungeonCats, t]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {tabs.map((cat) => {
          const isGroup = !!cat.children;
          const isGroupActive = isGroup && cat.children!.some((c) => c.key === category);
          const isActive = cat.key === category || isGroupActive;
          const isGroupExpanded = expandedGroup === cat.key;

          return (
            <button
              key={cat.key}
              onClick={() => {
                if (isGroup) {
                  setExpandedGroup(isGroupExpanded ? null : cat.key);
                } else {
                  onChange(cat.key);
                  setExpandedGroup(null);
                }
              }}
              className={`card p-4 text-center transition-all ${
                isActive || isGroupExpanded
                  ? 'border-gold/50 bg-gold/[0.03]'
                  : 'hover:border-gold/20'
              }`}
            >
              <div
                className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
                  isActive || isGroupExpanded ? 'bg-primary/20' : 'bg-primary/10'
                }`}
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
                className={`text-[15px] font-semibold transition-colors ${
                  isActive || isGroupExpanded ? 'text-primary' : 'text-on-surface'
                }`}
              >
                {cat.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Sub-category row for expanded groups */}
      {expandedGroup && (() => {
        const group = tabs.find((t) => t.key === expandedGroup);
        if (!group?.children) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {group.children.map((sub) => {
              const isActive = sub.key === category;
              return (
                <button
                  key={sub.key}
                  onClick={() => onChange(sub.key)}
                  className={`rounded-lg border px-4 py-2.5 text-[14px] font-semibold transition-all ${
                    isActive
                      ? 'border-gold/50 bg-gold/[0.06] text-primary'
                      : 'border-outline-variant/10 bg-surface-container-high text-on-surface hover:border-gold/20 hover:text-primary'
                  }`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
