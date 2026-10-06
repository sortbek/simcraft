'use client';
import { useMemo, type ReactNode } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import Checkbox from '../ui/Checkbox';
import InfoIcon from '../ui/InfoIcon';
import { useLanguage } from '../../lib/i18n';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
import { useLootCatalog } from './useLootCatalog';
import { parseLootCharacter, type LootCatalog } from './lootConfiguration';
import { useLootBrowserModel, type LootSubmission } from './useLootBrowserModel';
import type { DifficultyDef } from '../../lib/types';
import { formatSpecName } from './types';
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
  return (
    <>
      <TalentPicker />

      <CategorySelector
        category={category}
        onChange={model.selectCategory}
        dungeonCats={dungeonCats}
        includeBonusRoll
      />

      {/* Configuration card: dungeon pool + difficulty + upgrade level */}
      {(isRaid || isDungeon || isBonusRoll) && (
        <div className="card space-y-4 p-5">
          {/* Bonus rolls: one tier per pool, each independently skippable. */}
          {isBonusRoll && (
            <>
              <div
                className={`grid gap-4 sm:grid-cols-2 ${currentTrackInfo && drops ? 'lg:grid-cols-3' : ''}`}
              >
                <div>
                  <label className="label-text">{t('dropFinder.raidBonusRoll')}</label>
                  <DifficultySelect
                    value={configuration.difficulty}
                    onChange={(key) => model.selectBonusRollTier('raid', key)}
                    difficulties={[noBonusRollTier(t), ...raidTiers]}
                    difficultyGroups={null}
                    upgradeTracks={upgradeTracks}
                  />
                </div>
                <div>
                  <label className="label-text">{t('dropFinder.mplusBonusRoll')}</label>
                  <DifficultySelect
                    value={configuration.dungeonDifficulty}
                    onChange={(key) => model.selectBonusRollTier('dungeon', key)}
                    difficulties={[noBonusRollTier(t), ...dungeonTiers]}
                    difficultyGroups={null}
                    upgradeTracks={upgradeTracks}
                  />
                </div>
                {/* A rank means "level N of each item's own track", so one control
                    serves both ladders; the labels follow the higher of the two. */}
                {currentTrackInfo && drops && (
                  <div>
                    <label className="label-text">{t('dropFinder.upgradeLevel')}</label>
                    <UpgradeSelect
                      value={configuration.upgradeLevel}
                      onChange={model.selectUpgrade}
                      options={upgradeLevelOptions}
                    />
                  </div>
                )}
              </div>
              {!configuration.difficulty && !configuration.dungeonDifficulty && (
                <p role="status" className="text-xs text-on-surface-variant">
                  {t('dropFinder.bonusRollPickTier')}
                </p>
              )}
            </>
          )}

          {/* Instance pool drawer */}
          {isDungeon && !isPoolOnly && dungeonInstances.length > 0 && (
            <div>
              <label className="label-text">{t('dropFinder.dungeonPool') ?? 'Dungeon pool'}</label>
              <DungeonDrawer
                instances={dungeonInstances}
                allLabel={t('loot.allDungeons')}
                selectedIds={configuration.pool}
                onChange={model.selectPool}
              />
            </div>
          )}
          {isRaid && raids.length > 0 && (
            <div>
              <label className="label-text">{t('dropFinder.selectRaid')}</label>
              <DungeonDrawer
                instances={raids}
                allLabel={t('loot.allRaids')}
                selectedIds={configuration.pool}
                onChange={model.selectPool}
              />
            </div>
          )}

          {/* Difficulty + upgrade level */}
          {activeDifficulties.length > 0 && (
            <div
              className={`grid gap-4 ${currentTrackInfo && drops && !isCrafted ? 'grid-cols-1 sm:grid-cols-2' : ''}`}
            >
              <div>
                <label className="label-text">{t('dropFinder.difficulty')}</label>
                <DifficultySelect
                  value={configuration.difficulty}
                  onChange={model.selectDifficulty}
                  difficulties={activeDifficulties}
                  difficultyGroups={activeDifficultyGroups}
                  upgradeTracks={upgradeTracks}
                  isCrafted={isCrafted}
                />
              </div>

              {/* Crafted gear has no in-game upgrade track. */}
              {currentTrackInfo && drops && !isCrafted && (
                <div>
                  <label className="label-text">{t('dropFinder.upgradeLevel')}</label>
                  <UpgradeSelect
                    value={configuration.upgradeLevel}
                    onChange={model.selectUpgrade}
                    options={upgradeLevelOptions}
                  />
                </div>
              )}
            </div>
          )}

          {/* Crafted gear and raid BOEs: choose the two secondary stats */}
          {usesPreferredStats && (
            <div>
              <label className="label-text">{t('dropFinder.preferredStats')}</label>
              <PreferredStatsSelect
                value={preferredStats}
                onChange={setPreferredStats}
                statIds={seasonConfig?.crafted_secondary_stats}
              />
            </div>
          )}

          {/* Which gem fills sockets the player's own gear does not cover, and
              whether a vault reward's extra socket is assumed. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-text">{t('dropFinder.preferredGem')}</label>
              <PreferredGemSelect
                value={model.preferredGemId}
                onChange={model.setPreferredGemId}
                gems={gems}
              />
            </div>
          </div>

          {/* Variant toggles: voidforge + catalyst */}
          <div className="flex flex-wrap items-center gap-4">
            <label
              className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant"
              title={t('dropFinder.upgradeEquippedTooltip')}
            >
              <Checkbox
                size="sm"
                checked={model.upgradeEquipped}
                onChange={() => model.setUpgradeEquipped((value) => !value)}
                aria-label={t('dropFinder.upgradeEquipped')}
              />
              {t('dropFinder.upgradeEquipped')}
            </label>
            <label
              className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant"
              title={t('dropFinder.addVaultSocketTooltip')}
            >
              <Checkbox
                size="sm"
                checked={model.addVaultSocket}
                onChange={() => model.setAddVaultSocket((value) => !value)}
                aria-label={t('dropFinder.addVaultSocket')}
              />
              {t('dropFinder.addVaultSocket')}
            </label>
            {/* The badge rather than a bare `title`: this toggle decides whether
                the rows you compare carry real numbers or a coarse estimate, and
                a native tooltip gives no hint that there is anything to read.
                InfoIcon swallows its own clicks, so it can't toggle the box. */}
            <label className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
              <Checkbox
                size="sm"
                checked={model.forceSinglePass}
                onChange={() => model.setForceSinglePass((value) => !value)}
                aria-label={t('dropFinder.fullPrecision')}
              />
              {t('dropFinder.fullPrecision')}
              <InfoIcon tooltip={t('dropFinder.fullPrecisionTooltip')} />
            </label>
            {VOID_FORGE_ENABLED && (
              <label className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                <Checkbox
                  size="sm"
                  checked={includeVoidForge}
                  onChange={() => setIncludeVoidForge((v) => !v)}
                  aria-label={t('dropFinder.includeVoidForge')}
                />
                {t('dropFinder.includeVoidForge')}
              </label>
            )}
            {/* Crafted gear can't be catalysed. */}
            {!isCrafted && (
              <label className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                <Checkbox
                  size="sm"
                  checked={includeCatalyst}
                  onChange={() => setIncludeCatalyst((v) => !v)}
                  aria-label={t('dropFinder.includeCatalyst')}
                />
                {t('dropFinder.includeCatalyst')}
              </label>
            )}
          </div>
        </div>
      )}

      {/* Spec filter */}
      <div className="flex flex-wrap items-center gap-2">
        {className ? (
          <>
            <p className="text-xs text-on-surface-variant">
              {t('dropFinder.showingLoot', { class: className.replace('_', ' ') })}
            </p>
            {allSpecs.length > 1 && (
              <>
                <span className="h-3.5 w-px bg-outline-variant/20" />
                <div className="flex flex-wrap gap-1">
                  {allSpecs.map((spec) => {
                    const isActive = activeSpecs.has(spec);
                    const isMain = spec === detectedSpec;
                    return (
                      <button
                        key={spec}
                        onClick={() => toggleSpec(spec)}
                        className={`rounded-md px-2 py-0.5 text-[13px] font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-gold/[0.08] text-gold'
                            : 'bg-surface-container-high text-on-surface-variant/40 hover:bg-surface-container-highest hover:text-on-surface-variant'
                        }`}
                      >
                        {formatSpecName(spec)}
                        {isMain && (
                          <span className="ml-1 text-[11px] opacity-50">
                            {t('dropFinder.mainSpec')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-outline">{t('dropFinder.pasteExport')}</p>
        )}

        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

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
        />
      )}
      {footer?.(model.submission)}
    </>
  );
}
