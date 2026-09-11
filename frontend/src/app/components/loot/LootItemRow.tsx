import { iconProps } from '../../lib/useItemInfo';
import type { LootItemRowModel } from './lootItemRowModel';
import { QUALITY_TEXT_CLASS, qualityBorderColor } from '../../lib/qualityColors';
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
  const qualityColor = QUALITY_TEXT_CLASS[row.quality] || 'text-gray-400';
  // At the 2-piece cap an unselected embellished drop cannot be added — the
  // limit categories that would reject it live in the item's own bonusLists and
  // never reach the submitted bonus_ids, so nothing downstream would catch it.
  const capBlocked = row.embellished && embellishmentLimitReached && !row.selected;
  return (
    <div
      onClick={() => !capBlocked && onToggle(row.uid)}
      title={capBlocked ? t('loot.embellishmentLimit') : undefined}
      className={`group grid grid-cols-12 items-center px-4 py-2 transition-colors ${
        capBlocked
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-surface-container-high/40'
      }`}
    >
      <div className="col-span-5 flex items-center gap-3">
        <Checkbox
          variant="primary"
          size="sm"
          checked={row.selected}
          disabled={capBlocked}
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
              className={`h-9 w-9 overflow-hidden rounded-md border-b-2 bg-surface-container-highest`}
              style={{ borderBottomColor: qualityBorderColor(row.quality) }}
            >
              <img
                {...iconProps(row.icon)}
                alt=""
                className={`h-full w-full object-cover ${row.offSpec ? 'opacity-60' : ''}`}
              />
            </div>
          </a>
          {row.embellished && (
            <div
              title={t(embellishmentLimitReached ? 'loot.embellishmentLimit' : 'loot.embellished')}
              className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white ${embellishmentLimitReached ? 'bg-red-500' : 'bg-purple-500'}`}
            >
              E
            </div>
          )}
          {row.offSpec && (
            <div
              title={t('loot.offSpecWarning')}
              className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black"
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
              className={`text-[13px] font-bold group-hover:underline ${qualityColor}`}
            >
              {row.name}
            </a>
            <VariantBadges item={row.variants} />
          </div>
          {row.source && <p className="text-[10px] text-on-surface-variant/60">{row.source}</p>}
        </div>
      </div>

      <div className={`text-center ${hasEmbellishmentColumn ? 'col-span-3' : 'col-span-5'}`}>
        <span className="rounded bg-surface-container-highest px-2 py-1 text-[10px] font-bold uppercase text-on-surface-variant">
          {row.slot}
        </span>
      </div>

      <div className="col-span-2 text-center">
        <span className="font-headline text-xs font-black tabular-nums text-on-surface">
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
