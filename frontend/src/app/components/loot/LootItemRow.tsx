import { iconProps } from '../../lib/useItemInfo';
import type { LootItemRowModel } from './lootItemRowModel';
import { qualityBorderColor, qualityHex } from '../../lib/qualityColors';
import Checkbox from '../ui/Checkbox';
import VariantBadges from './VariantBadges';
import EmbellishmentSelect from './EmbellishmentSelect';
import { useLanguage } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { GEAR_ROW_METRICS, type GearRowDensity } from '../gear/gearDensity';

interface LootItemRowProps {
  row: LootItemRowModel;
  /** Grouped by instance: the slot moves into the row's source line. */
  showSlot: boolean;
  density?: GearRowDensity;
  /** List-level, identical for every row — passed down rather than restamped. */
  embellishmentLimitReached: boolean;
  onToggle: (uid: string) => void;
  onEmbellishmentChange?: (itemId: number, id: number | null) => void;
}
export default function LootItemRow({
  row,
  showSlot,
  density = 'compact',
  embellishmentLimitReached,
  onToggle,
  onEmbellishmentChange,
}: LootItemRowProps) {
  const { t } = useLanguage();
  const qualityColor = qualityHex(row.quality);
  const metrics = GEAR_ROW_METRICS[density];
  const ultra = density === 'ultra';
  const sourceLine = [showSlot ? row.slot : '', row.source].filter(Boolean).join(' · ');
  // At the 2-piece cap an unselected embellished drop cannot be added — the
  // limit categories that would reject it live in the item's own bonusLists and
  // never reach the submitted bonus_ids, so nothing downstream would catch it.
  const capBlocked = row.embellished && embellishmentLimitReached && !row.selected;
  // Gear already owned on this track or better can never be worth simming, so
  // the row is inert rather than merely unticked. Its reason outranks the cap's:
  // it is permanent, where the cap depends on what else is picked.
  const blocked = capBlocked || row.variants.owned === true;
  const blockedReason = row.variants.owned
    ? t('loot.alreadyOwnedReason')
    : capBlocked
      ? t('loot.embellishmentLimit')
      : undefined;
  return (
    <div
      onClick={() => !blocked && onToggle(row.uid)}
      title={blockedReason}
      className={cn(
        'group flex items-center rounded-[7px] border border-transparent transition-colors duration-[120ms]',
        metrics.row,
        blocked
          ? 'cursor-not-allowed opacity-50'
          : row.selected
            ? 'cursor-pointer bg-gold-sel'
            : 'cursor-pointer hover:bg-overlay/[0.03]'
      )}
    >
      <Checkbox
        size={density === 'comfortable' ? 'md' : 'sm'}
        checked={row.selected}
        disabled={blocked}
        onChange={() => onToggle(row.uid)}
        aria-label={row.name}
      />
      <div className="relative shrink-0">
        <a
          href={row.href}
          data-wowhead={row.tooltip}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="block"
        >
          <div
            className={cn(
              'relative overflow-hidden rounded-[5px] border bg-surface-container-highest',
              metrics.icon
            )}
            style={{ borderColor: qualityBorderColor(row.quality) }}
          >
            <img
              {...iconProps(row.icon)}
              alt=""
              className={`h-full w-full object-cover ${row.offSpec ? 'opacity-60' : ''}`}
            />
            <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
          </div>
        </a>
        {row.embellished && (
          <div
            title={t(embellishmentLimitReached ? 'loot.embellishmentLimit' : 'loot.embellished')}
            className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[11px] font-bold leading-none text-on-badge ${embellishmentLimitReached ? 'bg-negative' : 'bg-quality-epic'}`}
          >
            E
          </div>
        )}
        {row.offSpec && (
          <div
            title={t('loot.offSpecWarning')}
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold-fill text-[11px] font-bold leading-none text-on-primary"
          >
            !
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <a
            href={row.href}
            data-wowhead={row.tooltip}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'truncate font-semibold leading-tight group-hover:underline',
              metrics.name
            )}
            style={{ color: qualityColor }}
          >
            {row.name}
          </a>
          <VariantBadges item={row.variants} />
          {ultra && sourceLine && (
            <span className={cn('min-w-0 flex-1 truncate text-outline', metrics.details)}>
              {sourceLine}
            </span>
          )}
        </div>
        {!ultra && sourceLine && (
          <p className={cn('mt-0.5 truncate text-outline', metrics.details)}>{sourceLine}</p>
        )}
        {row.catalystSource && (
          <p
            title={t('loot.catalystFromReason')}
            className={cn('mt-px truncate italic text-quality-rare/70', metrics.details)}
          >
            {t('loot.catalystFrom', { item: row.catalystSource })}
          </p>
        )}
        {row.embellishment && onEmbellishmentChange && (
          <div className="mt-1.5 max-w-[240px]" onClick={(e) => e.stopPropagation()}>
            <EmbellishmentSelect
              value={row.embellishment.value}
              onChange={(id) => onEmbellishmentChange(row.itemId, id)}
              options={row.embellishment.options}
            />
          </div>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 font-headline font-extrabold tabular-nums text-on-surface',
          metrics.ilevel
        )}
      >
        {row.ilevel}
      </span>
    </div>
  );
}
