import type { ResolvedItem } from '../../lib/types';
import { getWowheadUrl, localizedItemName } from '../../lib/useItemInfo';
import GearItemRow from './GearItemRow';
import type { DisplayGroup } from './topGearSelection';

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface DetailPart {
  text: string;
  color?: string;
}

interface TopGearGroupCardProps {
  group: DisplayGroup;
  equipped: ResolvedItem[];
  alternatives: ResolvedItem[];
  locale: string;
  title: string;
  itemDetails: (item: ResolvedItem) => DetailPart[];
  isItemSelected: (item: ResolvedItem, group: DisplayGroup) => boolean;
  onToggleItem: (item: ResolvedItem, group: DisplayGroup) => void;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: (item: ResolvedItem, key: string) => void;
  onUpgradeSelect: (item: ResolvedItem, option: UpgradeOption) => void;
  onCatalystConvert: (item: ResolvedItem) => void;
  onVoidForgeConvert: (item: ResolvedItem) => void;
  onAddSocket: (item: ResolvedItem) => void;
  onRemoveGem: (item: ResolvedItem) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

function getWowheadData(item: ResolvedItem): string {
  const parts: string[] = [];
  if (item.bonus_ids.length > 0) parts.push(`bonus=${item.bonus_ids.join(':')}`);
  if (item.ilevel > 0) parts.push(`ilvl=${item.ilevel}`);
  if (item.enchant_id > 0) parts.push(`ench=${item.enchant_id}`);
  if (item.gem_id > 0) parts.push(`gems=${item.gem_id}`);
  return parts.join('&');
}

function canAddSocket(item: ResolvedItem): boolean {
  return (
    item.sockets === 0 &&
    ['head', 'neck', 'wrist', 'waist', 'finger1', 'finger2'].includes(item.slot)
  );
}

export default function TopGearGroupCard({
  group,
  equipped,
  alternatives,
  locale,
  title,
  itemDetails,
  isItemSelected,
  onToggleItem,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onVoidForgeConvert,
  onAddSocket,
  onRemoveGem,
  t,
}: TopGearGroupCardProps) {
  return (
    <div className="card space-y-1 p-3.5">
      <p className="mb-2 font-headline text-[13px] font-semibold uppercase tracking-widest text-muted">
        {title}
      </p>

      {equipped.map((item, index) => (
        <GearItemRow
          key={`eq-${item.uid}-${index}`}
          icon={item.icon}
          name={localizedItemName(item.item_id, item.name, locale)}
          nameColor={item.quality_color}
          details={itemDetails(item)}
          ilevel={item.ilevel}
          equipped
          href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
          wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
        >
          <UpgradeButton
            item={item}
            upgradeMenuFor={upgradeMenuFor}
            upgradeOptions={upgradeOptions}
            loadingUpgrades={loadingUpgrades}
            onUpgradeClick={() => onUpgradeClick(item, item.uid)}
            onUpgradeSelect={(option) => onUpgradeSelect(item, option)}
            onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
            onVoidForgeConvert={item.can_void_forge ? () => onVoidForgeConvert(item) : undefined}
            onAddSocket={canAddSocket(item) ? () => onAddSocket(item) : undefined}
            onRemoveGem={item.gem_id > 0 ? () => onRemoveGem(item) : undefined}
            t={t}
          />
        </GearItemRow>
      ))}

      {equipped.length > 0 && alternatives.length > 0 && (
        <div className="!my-1.5 border-t border-outline-variant/20" />
      )}

      {alternatives.map((item, index) => (
        <GearItemRow
          key={`alt-${item.uid}-${index}`}
          icon={item.icon}
          name={localizedItemName(item.item_id, item.name, locale)}
          nameColor={item.quality_color}
          details={itemDetails(item)}
          ilevel={item.ilevel}
          selectable
          checked={isItemSelected(item, group)}
          onToggle={() => onToggleItem(item, group)}
          vault={item.origin === 'vault'}
          loot={item.origin === 'loot'}
          catalyst={item.is_catalyst}
          voidForge={item.is_void_forge}
          href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
          wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
        >
          <UpgradeButton
            item={item}
            upgradeMenuFor={upgradeMenuFor}
            upgradeOptions={upgradeOptions}
            loadingUpgrades={loadingUpgrades}
            onUpgradeClick={() => onUpgradeClick(item, item.uid)}
            onUpgradeSelect={(option) => onUpgradeSelect(item, option)}
            onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
            onVoidForgeConvert={item.can_void_forge ? () => onVoidForgeConvert(item) : undefined}
            onAddSocket={canAddSocket(item) ? () => onAddSocket(item) : undefined}
            onRemoveGem={item.gem_id > 0 ? () => onRemoveGem(item) : undefined}
            t={t}
          />
        </GearItemRow>
      ))}
    </div>
  );
}

function UpgradeButton({
  item,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onVoidForgeConvert,
  onAddSocket,
  onRemoveGem,
  t,
}: {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onVoidForgeConvert?: () => void;
  onAddSocket?: () => void;
  onRemoveGem?: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!item.upgrade && !onCatalystConvert && !onVoidForgeConvert && !onAddSocket && !onRemoveGem)
    return null;
  const isMenuOpen = upgradeMenuFor === item.uid;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onUpgradeClick();
        }}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isMenuOpen
            ? 'bg-gold/20 text-gold'
            : 'text-on-surface-variant/50 hover:bg-white/[0.05] hover:text-on-surface-variant'
        }`}
        title={t('gear.addUpgradedCopy')}
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M8 12V4M5 7l3-3 3 3" />
        </svg>
      </button>
      {isMenuOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-outline-variant/20 bg-surface-container py-1 shadow-xl">
          {onCatalystConvert && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onCatalystConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a1 1 0 011 1v2.07A5.001 5.001 0 0113 9a5 5 0 01-10 0 5.001 5.001 0 014-4.93V2a1 1 0 011-1zm0 5a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              {t('gear.convertToCatalyst')}
            </button>
          )}
          {onVoidForgeConvert && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onVoidForgeConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a1 1 0 011 1v2.07A5.001 5.001 0 0113 9a5 5 0 01-10 0 5.001 5.001 0 014-4.93V2a1 1 0 011-1zm0 5a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              {t('gear.convertToVoidForge')}
            </button>
          )}
          {onAddSocket && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onAddSocket();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
            >
              <svg
                className="h-3 w-3 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M8 4v8M4 8h8" />
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('gear.addSocket')}
            </button>
          )}
          {onRemoveGem && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onRemoveGem();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              <svg
                className="h-3 w-3 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M4 8h8" />
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('gear.removeGem')}
            </button>
          )}
          {(onCatalystConvert || onVoidForgeConvert || onAddSocket || onRemoveGem) &&
            item.upgrade && <div className="my-1 border-t border-outline-variant/20" />}
          {item.upgrade && (
            <>
              {loadingUpgrades ? (
                <div className="px-3 py-2 text-[13px] text-muted">{t('common.loading')}</div>
              ) : upgradeOptions.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-muted">{t('gear.noUpgradeOptions')}</div>
              ) : (
                upgradeOptions.map((option) => {
                  const isCurrent = item.bonus_ids.includes(option.bonus_id);
                  return (
                    <button
                      key={option.bonus_id}
                      type="button"
                      disabled={isCurrent}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        onUpgradeSelect(option);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${
                        isCurrent
                          ? 'cursor-default text-muted'
                          : 'text-on-surface hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      <span>{option.fullName}</span>
                      <span className="font-mono text-[12px] tabular-nums text-muted">
                        {option.itemLevel}
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
