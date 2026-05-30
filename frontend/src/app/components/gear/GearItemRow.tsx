/**
 * Shared gear item row used across Top Gear, Upgrade Compare, and other pages.
 * Renders an item with icon, quality-colored name, detail parts, and optional checkbox.
 */
/* eslint-disable @next/next/no-img-element */

import { cn } from '../../lib/cn';
import { GEAR_STATUS_STYLES, gearStatusFrom } from '../../lib/statusStyles';
import Checkbox from '../ui/Checkbox';

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
}

function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
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
}: GearItemRowProps) {
  const status = gearStatusFrom({ vault, loot, catalyst, voidForge });
  const statusStyle = status ? GEAR_STATUS_STYLES[status] : null;

  const content = (
    <>
      {/* Checkbox or equipped indicator */}
      {selectable ? (
        <Checkbox checked={!!checked} onChange={onToggle} aria-label={name} />
      ) : equipped ? (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-white/10">
          <svg className="h-3 w-3 text-white/40" viewBox="0 0 16 16" fill="none">
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

      {/* Item icon */}
      <a
        href={href}
        data-wowhead={wowheadData}
        className={cn(
          'block h-8 w-8 shrink-0 overflow-hidden rounded',
          statusStyle ? statusStyle.iconRing : 'ring-1 ring-white/5'
        )}
        target="_blank"
        rel="noopener noreferrer"
        onClick={href ? (e) => e.preventDefault() : undefined}
      >
        <img
          src={getIconUrl(icon)}
          alt=""
          width={32}
          height={32}
          className="h-full w-full"
          loading="lazy"
        />
      </a>

      {/* Name + details */}
      <div className="min-w-0 flex-1">
        <a
          href={href}
          data-wowhead={wowheadData}
          className="block truncate text-[15px] leading-tight no-underline"
          style={{ color: nameColor }}
          target="_blank"
          rel="noopener noreferrer"
          onClick={href ? (e) => e.preventDefault() : undefined}
        >
          {name}
        </a>
        {details && details.length > 0 && (
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {details.map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="opacity-40"> · </span>}
                <span className={p.color || ''}>{p.text}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Right side: children + ilvl */}
      {children}
      {ilevel != null && ilevel > 0 && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{ilevel}</span>
      )}
    </>
  );

  // Row styling
  const baseClass = 'flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors';

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
