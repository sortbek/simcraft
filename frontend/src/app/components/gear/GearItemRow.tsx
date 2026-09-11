/** Shared gear item row (Top Gear, Upgrade Compare, etc.): icon, quality-colored name, detail parts, optional checkbox. */
/* eslint-disable @next/next/no-img-element */

import { cn } from '../../lib/cn';
import { GEAR_STATUS_STYLES, gearStatusFrom } from '../../lib/statusStyles';
import { iconProps } from '../../lib/useItemInfo';
import Checkbox from '../ui/Checkbox';
import { GEAR_ROW_METRICS, type GearRowDensity } from './gearDensity';

interface DetailPart {
  text: string;
  color?: string;
}

interface GearItemRowProps {
  /** Item icon name (e.g. "inv_helm_cloth_raidmage_s_01") */
  icon: string;
  /** Item name */
  name: string;
  /** CSS color for the item name (quality color) */
  nameColor: string;
  /** Detail parts shown below the name (tag, upgrade, gem, enchant, etc.) */
  details?: DetailPart[];
  /** Item level shown on the right */
  ilevel?: number;
  /** Whether this row has a selectable checkbox */
  selectable?: boolean;
  /** Current checked state (only used when selectable) */
  checked?: boolean;
  /** Checkbox change handler */
  onToggle?: () => void;
  /** Whether this is the currently equipped item (shows static checkmark) */
  equipped?: boolean;
  /** Vault item styling */
  vault?: boolean;
  /** Loot roll item styling */
  loot?: boolean;
  /** Catalyst item styling */
  catalyst?: boolean;
  /** Void Forge item styling */
  voidForge?: boolean;
  /** Wowhead link URL */
  href?: string;
  /** Wowhead data attribute */
  wowheadData?: string;
  /** Optional content rendered after the details (e.g. upgrade button) */
  children?: React.ReactNode;
  /** Row metrics; defaults to the original size so other pages are unaffected. */
  density?: GearRowDensity;
}

export default function GearItemRow({
  icon,
  name,
  nameColor,
  details,
  ilevel,
  selectable,
  checked,
  onToggle,
  equipped,
  vault,
  loot,
  catalyst,
  voidForge,
  href,
  wowheadData,
  children,
  density = 'comfortable',
}: GearItemRowProps) {
  const status = gearStatusFrom({ vault, loot, catalyst, voidForge });
  const statusStyle = status ? GEAR_STATUS_STYLES[status] : null;
  const metrics = GEAR_ROW_METRICS[density];

  const content = (
    <>
      {selectable ? (
        <Checkbox
          checked={!!checked}
          onChange={onToggle}
          size={density === 'comfortable' ? 'md' : 'sm'}
          aria-label={name}
        />
      ) : equipped ? (
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[3px] bg-white/10',
            metrics.box
          )}
        >
          <svg className={cn('text-white/40', metrics.check)} viewBox="0 0 16 16" fill="none">
            <path
              d="M12 5L6.5 10.5L4 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}

      <a
        href={href}
        data-wowhead={wowheadData}
        className={cn(
          'block shrink-0 overflow-hidden rounded',
          metrics.icon,
          statusStyle ? statusStyle.iconRing : 'ring-1 ring-white/5'
        )}
        target="_blank"
        rel="noopener noreferrer"
        onClick={href ? (e) => e.preventDefault() : undefined}
      >
        <img
          {...iconProps(icon)}
          alt=""
          width={32}
          height={32}
          className="h-full w-full"
          loading="lazy"
        />
      </a>

      <div
        className={cn(
          'min-w-0 flex-1',
          density === 'ultra' && 'flex items-baseline gap-1.5 overflow-hidden'
        )}
      >
        <a
          href={href}
          data-wowhead={wowheadData}
          className={cn(
            'truncate leading-tight no-underline',
            metrics.name,
            density === 'ultra' ? 'block shrink' : 'block'
          )}
          style={{ color: nameColor }}
          target="_blank"
          rel="noopener noreferrer"
          onClick={href ? (e) => e.preventDefault() : undefined}
        >
          {name}
        </a>
        {details && details.length > 0 && (
          <span
            className={cn(
              'block truncate text-muted',
              metrics.details,
              density === 'ultra' ? 'min-w-0 flex-1' : 'mt-0.5'
            )}
          >
            {details.map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="opacity-40"> · </span>}
                <span className={p.color || ''}>{p.text}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {children}
      {ilevel != null && ilevel > 0 && (
        <span className={cn('shrink-0 font-mono tabular-nums text-muted', metrics.ilevel)}>
          {ilevel}
        </span>
      )}
    </>
  );

  const baseClass = cn('flex items-center rounded-md transition-colors', metrics.row);

  if (selectable) {
    return (
      <label
        className={cn(
          'group cursor-pointer',
          baseClass,
          checked
            ? statusStyle
              ? statusStyle.rowChecked
              : 'bg-gold/[0.07]'
            : statusStyle
              ? statusStyle.rowUnchecked
              : 'hover:bg-white/[0.02]'
        )}
      >
        {content}
      </label>
    );
  }

  return <div className={`${baseClass} ${equipped ? 'bg-white/[0.03]' : ''}`}>{content}</div>;
}
