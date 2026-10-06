/* eslint-disable @next/next/no-img-element */
import { formatDps } from '../../lib/format';
import { iconProps } from '../../lib/useItemInfo';

interface AbilityRow {
  name: string;
  portion_dps: number;
}

interface ResultsChartRowProps {
  ability: AbilityRow;
  percent: number;
  barWidth: number;
  iconName?: string;
  compact?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

/** Mock `.db`: icon, uppercase name with share %, gold gradient bar, DPS value. */
export default function ResultsChartRow({
  ability,
  percent,
  barWidth,
  iconName,
  compact = false,
  expandable = false,
  expanded = false,
  onToggle,
}: ResultsChartRowProps) {
  const name = ability.name.replace(/_/g, ' ');

  return (
    <div
      className={`grid grid-cols-[34px_1fr_74px] items-center gap-3.5 ${
        compact ? 'py-1.5 pl-12 opacity-75' : 'py-2.5'
      }`}
    >
      <div className="relative h-7 w-7 overflow-hidden rounded-[5px] border border-line/[0.11] bg-surface-container-high">
        {iconName && <img {...iconProps(iconName)} alt="" className="h-full w-full object-cover" />}
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
      </div>
      <div className={`min-w-0 ${onToggle ? 'cursor-pointer' : ''}`} onClick={onToggle}>
        <div className="mb-[7px] flex items-center justify-between gap-2 font-headline text-xs font-extrabold uppercase tracking-[0.08em]">
          <span className="flex min-w-0 items-center gap-1.5">
            {expandable && (
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-outline transition-transform duration-150 ${
                  expanded ? 'rotate-90' : ''
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            <span className="truncate">{name}</span>
          </span>
          <span className="shrink-0 font-sans font-semibold normal-case tracking-normal text-on-surface-variant">
            {percent.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[6px] bg-surface-container-highest">
          <div
            className="h-full rounded-[6px] bg-gradient-to-r from-gold-dark to-gold-fill transition-all"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
      <div className="text-right font-headline text-[15px] font-extrabold">
        {formatDps(ability.portion_dps, 0)}
        <small className="block text-[11px] font-bold tracking-[0.14em] text-fg-4">DPS</small>
      </div>
    </div>
  );
}
