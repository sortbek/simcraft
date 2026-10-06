import { iconProps } from '../../lib/useItemInfo';
import type { LootItemRowModel } from './lootItemRowModel';
import { qualityBorderColor, qualityHex } from '../../lib/qualityColors';
import Pill from '../ui/Pill';
import Checkbox from '../ui/Checkbox';
import VariantBadges from './VariantBadges';
import EmbellishmentSelect from './EmbellishmentSelect';
import { useLanguage } from '../../lib/i18n';

interface LootItemRowProps {
  row: LootItemRowModel;
  /** Table-level, identical for every row — passed down rather than restamped. */
  hasEmbellishmentColumn: boolean;
  embellishmentLimitReached: boolean;
  onToggle: (uid: string) => void;
  onEmbellishmentChange?: (itemId: number, id: number | null) => void;
}
export default function LootItemRow({
  row,
  hasEmbellishmentColumn,
  embellishmentLimitReached,
  onToggle,
  onEmbellishmentChange,
}: LootItemRowProps) {
  const { t } = useLanguage();
  const qualityColor = qualityHex(row.quality);
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
      className={`group grid grid-cols-12 items-center px-6 py-3 transition-colors duration-[120ms] ${
        blocked
          ? 'cursor-not-allowed opacity-50'
          : row.selected
            ? 'cursor-pointer bg-gold-sel ring-1 ring-inset ring-gold-edge'
            : 'cursor-pointer hover:bg-overlay/[0.015]'
      }`}
    >
      <div className="col-span-5 flex items-center gap-3">
        <Checkbox
          size="sm"
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
              className="relative h-[38px] w-[38px] overflow-hidden rounded-[5px] border bg-surface-container-highest"
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
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <a
              href={row.href}
              data-wowhead={row.tooltip}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-semibold leading-tight group-hover:underline"
              style={{ color: qualityColor }}
            >
              {row.name}
            </a>
            <VariantBadges item={row.variants} />
          </div>
          {row.source && <p className="mt-px text-xs text-outline">{row.source}</p>}
          {row.catalystSource && (
            <p
              title={t('loot.catalystFromReason')}
              className="mt-px text-xs italic text-quality-rare/70"
            >
              {t('loot.catalystFrom', { item: row.catalystSource })}
            </p>
          )}
        </div>
      </div>

      <div className={`text-center ${hasEmbellishmentColumn ? 'col-span-3' : 'col-span-5'}`}>
        <Pill>{row.slot}</Pill>
      </div>

      <div className="col-span-2 text-center">
        <span className="font-headline text-sm font-extrabold tabular-nums text-on-surface">
          {row.ilevel}
        </span>
      </div>

      {row.embellishment && onEmbellishmentChange && (
        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
          <EmbellishmentSelect
            value={row.embellishment.value}
            onChange={(id) => onEmbellishmentChange(row.itemId, id)}
            options={row.embellishment.options}
          />
        </div>
      )}
    </div>
  );
}
