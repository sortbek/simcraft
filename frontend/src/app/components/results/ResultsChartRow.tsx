/* eslint-disable @next/next/no-img-element */

interface AbilityRow {
  name: string;
  portion_dps: number;
}

interface ResultsChartRowProps {
  ability: AbilityRow;
  color: string;
  percent: number;
  barWidth: number;
  iconName?: string;
  compact?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

function formatDps(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toLocaleString();
}

export default function ResultsChartRow({
  ability,
  color,
  percent,
  barWidth,
  iconName,
  compact = false,
  expandable = false,
  expanded = false,
  onToggle,
}: ResultsChartRowProps) {
  const name = ability.name.replace(/_/g, ' ');
  const containerClass = compact
    ? 'mt-2 flex items-center gap-4 pl-14 opacity-75'
    : 'flex items-center gap-4';
  const iconBoxClass = compact
    ? 'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-outline-variant bg-surface-container-highest'
    : 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-outline-variant bg-surface-container-highest';
  const barClass = compact
    ? 'h-4 w-full overflow-hidden rounded bg-surface-container-highest/30'
    : 'h-6 w-full overflow-hidden rounded bg-surface-container-highest/30';
  const nameClass = compact
    ? 'flex items-end justify-between text-[11px] font-bold uppercase text-on-surface-variant/60'
    : 'flex items-end justify-between text-xs font-bold uppercase';
  const dpsValueClass = compact
    ? 'font-headline text-xs font-bold text-on-surface-variant'
    : 'font-headline text-sm font-bold text-on-surface';
  const dpsLabelClass = compact
    ? 'block text-[9px] uppercase opacity-40'
    : 'block text-[10px] uppercase opacity-50';

  return (
    <div className={containerClass}>
      {expandable && (
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform duration-150 ${
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
      <div className={iconBoxClass}>
        {iconName ? (
          <img
            src={`https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-surface-container-highest" />
        )}
      </div>
      <div
        className={`min-w-0 flex-1 space-y-1 ${onToggle ? 'cursor-pointer' : ''}`}
        onClick={onToggle}
      >
        <div className={nameClass}>
          <span className="truncate">{name}</span>
          <span className={compact ? '' : 'text-on-surface'}>{percent.toFixed(1)}%</span>
        </div>
        <div className={barClass}>
          <div
            className="h-full rounded transition-all"
            style={{
              width: `${barWidth}%`,
              background: color,
              opacity: compact ? 0.7 : 1,
            }}
          />
        </div>
      </div>
      <div className="w-24 shrink-0 text-right">
        <span className={dpsValueClass}>{formatDps(ability.portion_dps)}</span>
        <span className={dpsLabelClass}>DPS</span>
      </div>
    </div>
  );
}
