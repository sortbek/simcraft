'use client';

import type { ReactNode } from 'react';
import Tooltip from '../ui/Tooltip';
import { useLanguage } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import type { GearRowDensity } from './gearDensity';

const ICON = {
  className: 'h-[15px] w-[15px]',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const DENSITIES: { key: GearRowDensity; label: string; icon: ReactNode }[] = [
  {
    key: 'comfortable',
    label: 'topGear.densityLarge',
    icon: (
      <svg {...ICON}>
        <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      </svg>
    ),
  },
  {
    key: 'compact',
    label: 'topGear.densityCompact',
    icon: (
      <svg {...ICON}>
        <path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11" />
      </svg>
    ),
  },
  {
    key: 'ultra',
    label: 'topGear.densityUltra',
    icon: (
      <svg {...ICON}>
        <path d="M2.5 3h11M2.5 5.5h11M2.5 8h11M2.5 10.5h11M2.5 13h11" />
      </svg>
    ),
  },
];

/** Large / Compact / Dense row-size switch for the gear card grids. */
export default function DensityToggle({
  density,
  onChange,
  className,
}: {
  density: GearRowDensity;
  onChange: (density: GearRowDensity) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[8px] border border-line/[0.06] bg-background p-[3px]',
        className
      )}
    >
      {DENSITIES.map(({ key, label, icon }) => (
        <Tooltip key={key} text={t(label)}>
          <button
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={density === key}
            aria-label={t(label)}
            className={cn(
              'flex h-6 w-[30px] items-center justify-center rounded-[5px] transition-colors',
              density === key
                ? 'bg-[color:var(--tab-on-bg)] text-on-surface [box-shadow:var(--tab-on-shadow)]'
                : 'text-outline hover:text-on-surface'
            )}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </span>
  );
}
