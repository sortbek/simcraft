'use client';
import { useMemo, type ReactNode } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import Checkbox from '../ui/Checkbox';
import { useLanguage } from '../../lib/i18n';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
import { useLootCatalog } from './useLootCatalog';
import { parseLootCharacter, type LootCatalog } from './lootConfiguration';
import { useLootBrowserModel, type LootSubmission } from './useLootBrowserModel';
import { formatSpecName } from './types';
import SlotFilter from './SlotFilter';
import ItemTable from './ItemTable';
import DungeonDrawer from './DungeonDrawer';
import DifficultySelect from './DifficultySelect';
import UpgradeSelect from './UpgradeSelect';
import PreferredStatsSelect from './PreferredStatsSelect';
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
  const model = useLootBrowserModel(catalog, character);
  const {
    configuration,
    details,
    query,
    drops,
    selection,
    activeSpecs,
    toggleSpec,
    availableSlots,
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
    poolOnly: isPoolOnly,
    raids,
    dungeonCats,
    difficulties: activeDifficulties,
    difficultyGroups: activeDifficultyGroups,
    instances: dungeonInstances,
  } = details;
  const { seasonConfig, upgradeTracks } = catalog;
  const { className, specName: detectedSpec, specs: allSpecs } = character;
  const { excludedSlots, toggleSlot, resetExcludedSlots } = selection;
  const category = configuration.category;
  const isDungeon = !isRaid && !!details.source;
  return (
    <>
      <TalentPicker />

      <CategorySelector
        category={category}
        onChange={model.selectCategory}
        dungeonCats={dungeonCats}
      />

      {/* Configuration card: dungeon pool + difficulty + upgrade level */}
      {(isRaid || isDungeon) && (
        <div className="card space-y-4 p-5">
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

          {/* Variant toggles: voidforge + catalyst */}
          <div className="flex flex-wrap items-center gap-4">
            {VOID_FORGE_ENABLED && (
              <label className="group flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                <Checkbox
                  variant="primary"
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
                  variant="primary"
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
          <p className="text-xs text-muted">{t('dropFinder.pasteExport')}</p>
        )}

        <SlotFilter
          availableSlots={availableSlots}
          excludedSlots={excludedSlots}
          toggleSlot={toggleSlot}
          resetExcludedSlots={resetExcludedSlots}
        />
      </div>

      {query.status === 'loading' && <Spinner />}
      {query.status === 'error' && <LoadError message={query.error} retry={query.retry} />}
      {model.table.embellishmentLimitReached &&
        model.table.rows.some((row) => row.selected && row.embellishment?.value != null) && (
          <p role="status" className="text-xs text-amber-400/80">
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
