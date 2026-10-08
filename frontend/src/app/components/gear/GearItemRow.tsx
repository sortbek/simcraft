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
  /** Colors the item level against what it would replace ('base': same level,
   *  or the equipped item itself). Unset keeps the original grey. */
  ilevelTone?: 'base' | 'up' | 'down';
  /** Whether this row has a selectable checkbox */
  selectable?: boolean;
  /** Current checked state (only used when selectable) */
  checked?: boolean;
  /** Checkbox change handler */
  onToggle?: () => void;
  /** Locks the checkbox in its current state */
  disabled?: boolean;
  /** Row tooltip, e.g. why the checkbox is locked */
  title?: string;
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
  ilevelTone,
  selectable,
  checked,
  onToggle,
  disabled,
  title,
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
          disabled={disabled}
          size={density === 'comfortable' ? 'md' : 'sm'}
          tone={equipped ? 'neutral' : 'gold'}
          aria-label={name}
        />
      ) : equipped ? (
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[3px] bg-overlay/[0.06]',
            metrics.box
          )}
        >
          <svg className={cn('text-outline', metrics.check)} viewBox="0 0 16 16" fill="none">
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
          'relative block shrink-0 overflow-hidden rounded-[5px]',
          metrics.icon,
          'border',
          statusStyle?.iconRing
        )}
        style={statusStyle ? undefined : { borderColor: nameColor }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={href ? (e) => e.preventDefault() : undefined}
      >
        <img
          {...iconProps(icon)}
          alt=""
          width={38}
          height={38}
          className="h-full w-full"
          loading="lazy"
        />
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
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
            'truncate font-semibold leading-tight no-underline',
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
              'block truncate text-outline',
              metrics.details,
              density === 'ultra' ? 'min-w-0 flex-1' : 'mt-0.5'
            )}
          >
            {details.map((p, i) => (
              <span key={i}>
                {i > 0 && <span> · </span>}
                <span className={p.color || ''}>{p.text}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {children}
      {ilevel != null && ilevel > 0 && (
        <span
          className={cn(
            'shrink-0 font-headline tabular-nums',
            ilevelTone ? 'font-extrabold' : 'font-bold',
            ilevelTone === 'up'
              ? 'text-positive'
              : ilevelTone === 'down'
                ? 'text-outline'
                : ilevelTone === 'base'
                  ? 'text-on-surface-variant'
                  : 'text-outline',
            metrics.ilevel
          )}
        >
          {ilevel}
        </span>
      )}
    </>
  );

  const baseClass = cn(
    'flex items-center rounded-[7px] border border-transparent transition-colors duration-[120ms]',
    metrics.row
  );

  if (selectable) {
    // A div, not a label: a label ignores clicks on its links (the icon and
    // name), so those spots never toggled. Nested buttons stop propagation.
    return (
      <div
        onClick={disabled ? undefined : onToggle}
        title={title}
        className={cn(
          'group',
          disabled ? 'cursor-default' : 'cursor-pointer',
          baseClass,
          checked
            ? statusStyle
              ? statusStyle.rowChecked
              : equipped
                ? 'border-line/[0.06] bg-overlay/[0.02]'
                : 'border-gold-edge bg-gold-sel'
            : statusStyle
              ? statusStyle.rowUnchecked
              : 'hover:bg-surface-container-high'
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className={`${baseClass} ${equipped ? 'border-line/[0.06] bg-overlay/[0.02]' : 'hover:bg-surface-container-high'}`}
    >
      {content}
    </div>
  );
}
