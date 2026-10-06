import { useRef } from 'react';
import type { ResolvedItem } from '../../lib/types';
import { usePopupDismissal } from '../loot/usePopupDismissal';
import { getWowheadData, getWowheadUrl, localizedItemName } from '../../lib/useItemInfo';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
import { serverQualityColor } from '../../lib/qualityColors';
import Pill from '../ui/Pill';
import GearItemRow from './GearItemRow';
import {
  GEAR_DENSITY_LAYOUT,
  GEAR_ROW_METRICS,
  gearCardClass,
  type GearRowDensity,
} from './gearDensity';
import { ENCHANT_SLOTS } from './itemOptions';
import { buildAlternativeKey } from './topGearIdentity';
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
  /** Slots whose equipped item is unticked. */
  excludedEquipped: Set<string>;
  /** Whether a ticked equipped item has a ticked alternative to stand in for it. */
  canExcludeEquipped: (item: ResolvedItem) => boolean;
  onToggleEquipped: (item: ResolvedItem) => void;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: (item: ResolvedItem, key: string) => void;
  onUpgradeMenuClose: () => void;
  onUpgradeSelect: (item: ResolvedItem, option: UpgradeOption) => void;
  onCatalystConvert: (item: ResolvedItem) => void;
  onVoidForgeConvert: (item: ResolvedItem) => void;
  onAddSocket: (item: ResolvedItem) => void;
  onRemoveGem: (item: ResolvedItem) => void;
  onEditGemsEnchant: (item: ResolvedItem) => void;
  addedKeys: Set<string>;
  onRemoveAdded: (item: ResolvedItem) => void;
  density: GearRowDensity;
  /** Present only for a group shown because it was promoted out of the
   *  unchanged strip; sends it back. */
  onDemote?: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

function canAddSocket(item: ResolvedItem): boolean {
  return (
    item.sockets === 0 &&
    ['head', 'neck', 'wrist', 'waist', 'finger1', 'finger2'].includes(item.slot)
  );
}

// Copies of catalyst/void-forge/vault items would re-resolve as plain bag
// items and escape the catalyst-charge and vault gear-set constraints.
function canManualCopy(item: ResolvedItem): boolean {
  return !item.is_catalyst && !item.is_void_forge && item.origin !== 'vault';
}

function canEditGemsEnchant(item: ResolvedItem): boolean {
  if (!canManualCopy(item)) return false;
  return item.sockets > 0 || item.gem_ids.length > 0 || ENCHANT_SLOTS.includes(item.slot);
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
  excludedEquipped,
  canExcludeEquipped,
  onToggleEquipped,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeMenuClose,
  onUpgradeSelect,
  onCatalystConvert,
  onVoidForgeConvert,
  onAddSocket,
  onRemoveGem,
  onEditGemsEnchant,
  addedKeys,
  onRemoveAdded,
  density,
  onDemote,
  t,
}: TopGearGroupCardProps) {
  const layout = GEAR_DENSITY_LAYOUT[density];

  return (
    <div className={gearCardClass(density)}>
      <p className={`h-card flex items-center gap-2 ${layout.title}`}>
        {title}
        {alternatives.length > 0 && (
          <Pill className="tabular-nums text-outline">{alternatives.length}</Pill>
        )}
        {onDemote && (
          <button
            type="button"
            onClick={onDemote}
            title={t('topGear.collapseSlot')}
            aria-label={t('topGear.collapseSlot')}
            className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-outline transition-colors hover:bg-overlay/[0.06] hover:text-on-surface-variant"
          >
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        )}
      </p>

      {equipped.map((item, index) => {
        const checked = !excludedEquipped.has(item.slot);
        const locked = checked && !canExcludeEquipped(item);
        return (
          <GearItemRow
            key={`eq-${item.uid}-${index}`}
            icon={item.icon}
            name={localizedItemName(item.item_id, item.name, locale)}
            nameColor={serverQualityColor(item.quality, item.quality_color)}
            details={itemDetails(item)}
            ilevel={item.ilevel}
            equipped
            selectable
            checked={checked}
            onToggle={() => onToggleEquipped(item)}
            disabled={locked}
            title={locked ? t('topGear.equippedLocked') : undefined}
            density={density}
            href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
          >
            <UpgradeButton
              item={item}
              upgradeMenuFor={upgradeMenuFor}
              upgradeOptions={upgradeOptions}
              loadingUpgrades={loadingUpgrades}
              onUpgradeClick={() => onUpgradeClick(item, item.uid)}
              onClose={onUpgradeMenuClose}
              onUpgradeSelect={(option) => onUpgradeSelect(item, option)}
              onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
              onVoidForgeConvert={item.can_void_forge ? () => onVoidForgeConvert(item) : undefined}
              onAddSocket={canAddSocket(item) ? () => onAddSocket(item) : undefined}
              onRemoveGem={
                item.gem_ids.length > 0 && canManualCopy(item) ? () => onRemoveGem(item) : undefined
              }
              onEditGemsEnchant={
                canEditGemsEnchant(item) ? () => onEditGemsEnchant(item) : undefined
              }
              density={density}
              t={t}
            />
          </GearItemRow>
        );
      })}

      {equipped.length > 0 && alternatives.length > 0 && (
        <div className={`border-t border-line/[0.06] ${layout.rule}`} />
      )}

      {alternatives.map((item, index) => (
        <GearItemRow
          key={`alt-${item.uid}-${index}`}
          icon={item.icon}
          name={localizedItemName(item.item_id, item.name, locale)}
          nameColor={serverQualityColor(item.quality, item.quality_color)}
          details={itemDetails(item)}
          ilevel={item.ilevel}
          selectable
          checked={isItemSelected(item, group)}
          onToggle={() => onToggleItem(item, group)}
          vault={item.origin === 'vault'}
          loot={item.origin === 'loot'}
          catalyst={item.is_catalyst}
          voidForge={item.is_void_forge}
          density={density}
          href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
          wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
        >
          {addedKeys.has(buildAlternativeKey(item)) && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onRemoveAdded(item);
              }}
              className={`flex shrink-0 items-center justify-center rounded-[5px] text-outline transition-colors hover:bg-negative/10 hover:text-negative ${GEAR_ROW_METRICS[density].button}`}
              title="Remove item"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          )}
          <UpgradeButton
            item={item}
            upgradeMenuFor={upgradeMenuFor}
            upgradeOptions={upgradeOptions}
            loadingUpgrades={loadingUpgrades}
            onUpgradeClick={() => onUpgradeClick(item, item.uid)}
            onClose={onUpgradeMenuClose}
            onUpgradeSelect={(option) => onUpgradeSelect(item, option)}
            onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
            onVoidForgeConvert={item.can_void_forge ? () => onVoidForgeConvert(item) : undefined}
            onAddSocket={canAddSocket(item) ? () => onAddSocket(item) : undefined}
            onRemoveGem={
              item.gem_ids.length > 0 && canManualCopy(item) ? () => onRemoveGem(item) : undefined
            }
            onEditGemsEnchant={canEditGemsEnchant(item) ? () => onEditGemsEnchant(item) : undefined}
            density={density}
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
  onClose,
  onUpgradeSelect,
  onCatalystConvert,
  onVoidForgeConvert: onVoidForgeConvertProp,
  onAddSocket,
  onRemoveGem,
  onEditGemsEnchant,
  density,
  t,
}: {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onClose: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onVoidForgeConvert?: () => void;
  onAddSocket?: () => void;
  onRemoveGem?: () => void;
  onEditGemsEnchant?: () => void;
  density: GearRowDensity;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  // Gated once so the surrounding menu guards agree with the button itself and
  // the menu never renders empty with Void Forge as its only action.
  const onVoidForgeConvert = VOID_FORGE_ENABLED ? onVoidForgeConvertProp : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const isMenuOpen = upgradeMenuFor === item.uid;
  usePopupDismissal(isMenuOpen, onClose, rootRef);
  if (
    !item.upgrade &&
    !onCatalystConvert &&
    !onVoidForgeConvert &&
    !onAddSocket &&
    !onRemoveGem &&
    !onEditGemsEnchant
  )
    return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onUpgradeClick();
        }}
        className={`flex items-center justify-center rounded-[5px] transition-colors ${GEAR_ROW_METRICS[density].button} ${
          isMenuOpen
            ? 'bg-gold/20 text-gold'
            : 'text-outline hover:bg-overlay/[0.06] hover:text-on-surface-variant'
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
        <div
          onClick={(event) => event.stopPropagation()}
          className="popover absolute right-0 top-full z-50 mt-2 min-w-[180px] py-1.5"
        >
          {onCatalystConvert && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onCatalystConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-quality-epic hover:bg-quality-epic/10"
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-quality-legendary hover:bg-quality-legendary/10"
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gem hover:bg-gem/10"
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
          {onEditGemsEnchant && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onEditGemsEnchant();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gold hover:bg-gold/10"
            >
              <svg
                className="h-3 w-3 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" />
              </svg>
              {t('gear.editGemsEnchant')}
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-negative hover:bg-negative/10"
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
          {(onCatalystConvert ||
            onVoidForgeConvert ||
            onAddSocket ||
            onRemoveGem ||
            onEditGemsEnchant) &&
            item.upgrade && <div className="my-1.5 border-t border-line/[0.06]" />}
          {item.upgrade && (
            <>
              {loadingUpgrades ? (
                <div className="px-3 py-2 text-[13px] text-outline">{t('common.loading')}</div>
              ) : upgradeOptions.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-outline">
                  {t('gear.noUpgradeOptions')}
                </div>
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
                          ? 'cursor-default text-outline'
                          : 'text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      <span>{option.fullName}</span>
                      <span className="font-headline text-xs font-bold tabular-nums text-outline">
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
