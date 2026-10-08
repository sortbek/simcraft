'use client';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import OptionChip from '../ui/OptionChip';
import { useLanguage } from '../../lib/i18n';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
import { useLootCatalog } from './useLootCatalog';
import { parseLootCharacter, type LootCatalog } from './lootConfiguration';
import { useLootBrowserModel, type LootSubmission } from './useLootBrowserModel';
import type { DifficultyDef } from '../../lib/types';
import LootFor from './LootFor';
import SlotFilter from './SlotFilter';
import SourceFilter from './SourceFilter';
import ItemTable from './ItemTable';
import DungeonDrawer from './DungeonDrawer';
import DifficultySelect from './DifficultySelect';
import UpgradeSelect from './UpgradeSelect';
import PreferredStatsSelect from './PreferredStatsSelect';
import PreferredGemSelect, { useGemOptions } from './PreferredGemSelect';
import { collectOwned } from './ownedDrops';
import { useResolvedGear } from '../../lib/useResolvedGear';
import CategorySelector from './CategorySelector';
import TalentPicker from '../talents/TalentPicker';
import ErrorAlert from '../ui/ErrorAlert';
function Spinner() {
  return (
    <div role="status" className="flex justify-center py-8">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
    </div>
  );
}
function LoadError({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useLanguage();
  return (
    <div role="alert" className="space-y-2 py-4">
      <ErrorAlert message={`${t('dropFinder.loadFailed')}: ${message}`} />
      <button type="button" className="text-gold underline" onClick={retry}>
        {t('common.retry')}
      </button>
    </div>
  );
}
/** "No roll on this side" — a trackless entry, so it shows neither track badge
 *  nor item level, and selecting it drops that half of the pool. */
function noBonusRollTier(t: (key: string) => string): DifficultyDef {
  return { key: '', label: t('dropFinder.bonusRollNone'), track: null, level: 0, sortOrder: 0 };
}
export interface LootBrowserProps {
  footer?: (submission: LootSubmission | null) => ReactNode;
}
export default function LootBrowser({ footer }: LootBrowserProps) {
  const catalog = useLootCatalog();
  const { simcInput } = useSimContext();
  const character = useMemo(() => parseLootCharacter(simcInput), [simcInput]);
  if (catalog.status === 'error')
    return <LoadError message={catalog.error} retry={catalog.retry} />;
  if (catalog.status !== 'success') return <Spinner />;
  return (
    <LootBrowserSession
      key={character.identity}
      catalog={catalog.data}
      character={character}
      footer={footer}
    />
  );
}
function LootBrowserSession({
  catalog,
  character,
  footer,
}: LootBrowserProps & { catalog: LootCatalog; character: ReturnType<typeof parseLootCharacter> }) {
  const { t } = useLanguage();
  const { simcInput } = useSimContext();
  // Equipped identity comes from the resolver, which knows each item's level and
  // upgrade track. It resolves to null on failure, so a hiccup means nothing is
  // excluded rather than a broken page.
  const { resolved } = useResolvedGear(simcInput);
  const owned = useMemo(() => collectOwned(resolved), [resolved]);
  const model = useLootBrowserModel(catalog, character, owned);
  const gems = useGemOptions();
  const {
    configuration,
    details,
    query,
    drops,
    selection,
    activeSpecs,
    toggleSpec,
    availableSlots,
    sources,
    currentTrackInfo,
    upgradeLevelOptions,
    preferredStats,
    setPreferredStats,
    includeVoidForge,
    setIncludeVoidForge,
    includeCatalyst,
    setIncludeCatalyst,
    usesPreferredStats,
  } = model;
  const {
    isRaid,
    isCrafted,
    isBonusRoll,
    poolOnly: isPoolOnly,
    raids,
    dungeonCats,
    difficulties: activeDifficulties,
    difficultyGroups: activeDifficultyGroups,
    instances: dungeonInstances,
    raidTiers,
    dungeonTiers,
  } = details;
  const { seasonConfig, upgradeTracks } = catalog;
  const { className, specName: detectedSpec, specs: allSpecs } = character;
  const { excludedSlots, toggleSlot, resetExcludedSlots, excludedSources, toggleSource } =
    selection;
  const category = configuration.category;
  const isDungeon = !isRaid && !!details.source;

  // The fields this source has, in the order the old card showed them.
  const setupCells: { key: string; label: string; control: ReactNode }[] = [];
  if (isBonusRoll) {
    setupCells.push(
      {
        key: 'raid-roll',
        label: t('dropFinder.raidBonusRoll'),
        control: (
          <DifficultySelect
            value={configuration.difficulty}
            onChange={(key) => model.selectBonusRollTier('raid', key)}
            difficulties={[noBonusRollTier(t), ...raidTiers]}
            difficultyGroups={null}
            upgradeTracks={upgradeTracks}
          />
        ),
      },
      {
        key: 'dungeon-roll',
        label: t('dropFinder.mplusBonusRoll'),
        control: (
          <DifficultySelect
            value={configuration.dungeonDifficulty}
            onChange={(key) => model.selectBonusRollTier('dungeon', key)}
            difficulties={[noBonusRollTier(t), ...dungeonTiers]}
            difficultyGroups={null}
            upgradeTracks={upgradeTracks}
          />
        ),
      }
    );
  }
  if (isDungeon && !isPoolOnly && dungeonInstances.length > 0) {
    setupCells.push({
      key: 'pool',
      label: t('dropFinder.dungeonPool') ?? 'Dungeon pool',
      control: (
        <DungeonDrawer
          instances={dungeonInstances}
          allLabel={t('loot.allDungeons')}
          selectedIds={configuration.pool}
          onChange={model.selectPool}
        />
      ),
    });
  }
  if (isRaid && raids.length > 0) {
    setupCells.push({
      key: 'raids',
      label: t('dropFinder.selectRaid'),
      control: (
        <DungeonDrawer
          instances={raids}
          allLabel={t('loot.allRaids')}
          selectedIds={configuration.pool}
          onChange={model.selectPool}
        />
      ),
    });
  }
  if (activeDifficulties.length > 0) {
    setupCells.push({
      key: 'difficulty',
      label: t('dropFinder.difficulty'),
      control: (
        <DifficultySelect
          value={configuration.difficulty}
          onChange={model.selectDifficulty}
          difficulties={activeDifficulties}
          difficultyGroups={activeDifficultyGroups}
          upgradeTracks={upgradeTracks}
          isCrafted={isCrafted}
        />
      ),
    });
  }
  // A rank means "level N of each item's own track", so one control serves
  // both bonus-roll ladders too. Crafted gear has no in-game upgrade track.
  if (currentTrackInfo && drops && (isBonusRoll || (activeDifficulties.length > 0 && !isCrafted))) {
    setupCells.push({
      key: 'upgrade',
      label: t('dropFinder.upgradeLevel'),
      control: (
        <UpgradeSelect
          value={configuration.upgradeLevel}
          onChange={model.selectUpgrade}
          options={upgradeLevelOptions}
        />
      ),
    });
  }
  // Crafted gear and raid BOEs: choose the two secondary stats.
  if (usesPreferredStats) {
    setupCells.push({
      key: 'stats',
      label: t('dropFinder.preferredStats'),
      control: (
        <PreferredStatsSelect
          value={preferredStats}
          onChange={setPreferredStats}
          statIds={seasonConfig?.crafted_secondary_stats}
        />
      ),
    });
  }
  // Which gem fills sockets the player's own gear does not cover.
  setupCells.push({
    key: 'gem',
    label: t('dropFinder.preferredGem'),
    control: (
      <PreferredGemSelect
        value={model.preferredGemId}
        onChange={model.setPreferredGemId}
        gems={gems}
      />
    ),
  });

  // Filters for the list below, shown in its header.
  const listFilters = (
    <>
      {className && allSpecs.length > 0 ? (
        <LootFor
          specs={allSpecs}
          active={activeSpecs}
          mainSpec={detectedSpec}
          onToggle={toggleSpec}
        />
      ) : (
        <span className="text-xs text-outline">{t('dropFinder.pasteExport')}</span>
      )}
      <SourceFilter
        sources={sources}
        excludedSources={excludedSources}
        toggleSource={toggleSource}
      />
      <SlotFilter
        availableSlots={availableSlots}
        excludedSlots={excludedSlots}
        toggleSlot={toggleSlot}
        resetExcludedSlots={resetExcludedSlots}
      />
    </>
  );

  return (
    <>
      <TalentPicker hideCompare />

      <CategorySelector
        category={category}
        onChange={model.selectCategory}
        dungeonCats={dungeonCats}
        includeBonusRoll
        className="-mx-8 !mt-3 px-8"
      />

      {/* The source's settings as one labelled row, its sim options below. */}
      {(isRaid || isDungeon || isBonusRoll) && (
        <div className="card loot-setup-wrap">
          <div className="loot-setup" style={{ '--n': setupCells.length } as CSSProperties}>
            {setupCells.map((cell) => (
              <div key={cell.key} className="loot-setup-cell">
                <span className="lbl">{cell.label}</span>
                {cell.control}
              </div>
            ))}
          </div>
          {isBonusRoll && !configuration.difficulty && !configuration.dungeonDifficulty && (
            <p role="status" className="px-5 pb-4 text-xs text-on-surface-variant">
              {t('dropFinder.bonusRollPickTier')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line/[0.06] px-5 py-4">
            <OptionChip
              checked={model.upgradeEquipped}
              onChange={(value) => model.setUpgradeEquipped(value)}
              text={t('dropFinder.optUpgradeEquipped')}
              tooltip={t('dropFinder.upgradeEquippedTooltip')}
            />
            <OptionChip
              checked={model.addVaultSocket}
              onChange={(value) => model.setAddVaultSocket(value)}
              text={t('dropFinder.optVaultSocket')}
              tooltip={t('dropFinder.addVaultSocketTooltip')}
            />
            {/* Decides whether the rows you compare carry real numbers or a
                coarse estimate, so it always explains itself on hover. */}
            <OptionChip
              checked={model.forceSinglePass}
              onChange={(value) => model.setForceSinglePass(value)}
              text={t('dropFinder.optFullPrecision')}
              tooltip={t('dropFinder.fullPrecisionTooltip')}
            />
            {VOID_FORGE_ENABLED && (
              <OptionChip
                checked={includeVoidForge}
                onChange={setIncludeVoidForge}
                text={t('dropFinder.optVoidForge')}
              />
            )}
            {/* Crafted gear can't be catalysed. */}
            {!isCrafted && (
              <OptionChip
                checked={includeCatalyst}
                onChange={setIncludeCatalyst}
                text={t('dropFinder.optCatalyst')}
              />
            )}
          </div>
        </div>
      )}

      {query.status === 'loading' && <Spinner />}
      {query.status === 'error' && <LoadError message={query.error} retry={query.retry} />}
      {model.table.embellishmentLimitReached &&
        model.table.rows.some((row) => row.selected && row.embellishment?.value != null) && (
          <p role="status" className="text-xs text-gold">
            {t('dropFinder.embellishmentCapWarning')}
          </p>
        )}
      {query.status === 'success' && (
        <ItemTable
          model={model.table}
          onToggle={selection.toggleItem}
          onSelectItems={selection.selectItems}
          onClearItems={selection.clearItems}
          onEmbellishmentChange={model.changeEmbellishment}
          filters={listFilters}
        />
      )}
      {footer?.(model.submission)}
    </>
  );
}
