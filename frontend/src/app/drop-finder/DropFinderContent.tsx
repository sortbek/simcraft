'use client';

import { useCallback } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useComputeChoice, type ComputeChoice } from '../lib/useComputeChoice';
import LootBrowser, { type LootBrowserRenderState } from '../components/loot/LootBrowser';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { useLanguage } from '../lib/i18n';
import { resolveUpgrade, type DropItemPayload } from '../components/loot/types';

interface DropFinderFooterProps {
  buildPayload: () => Record<string, unknown> | null;
  hasSelection: boolean;
  hasCharacter: boolean;
  count: number;
  compute: ComputeChoice;
  onComputeChange: (v: ComputeChoice) => void;
}

function DropFinderFooter({
  buildPayload,
  hasSelection,
  hasCharacter,
  count,
  compute,
  onComputeChange,
}: DropFinderFooterProps) {
  const { t } = useLanguage();

  const validate = useCallback(() => {
    if (!hasSelection) return t('validation.selectItems');
    return null;
  }, [hasSelection, t]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({ endpoint: '/api/droptimizer/sim', buildPayload, validate });

  const submitLabel = !hasCharacter
    ? t('validation.pasteSimcDropFinder')
    : !hasSelection
      ? t('validation.selectItemsDropFinder')
      : buttonLabel(t('button.findUpgrades', { count }));

  return (
    <>
      <SimcDownloadBanner />
      <ErrorAlert message={error} />
      <ConfigFooter
        onSubmit={handleSubmit}
        submitting={submitting}
        buttonLabel={submitLabel}
        disabled={!hasSelection || !hasCharacter}
        compute={compute}
        onComputeChange={onComputeChange}
      />
    </>
  );
}

export default function DropFinderContent() {
  const { t } = useLanguage();
  const { simcInput, hasInput } = useSimContext();
  const [compute, setCompute] = useComputeChoice('droptimizer');

  return (
    <div className="space-y-4 pb-20">
      {/* Page header */}
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          {t('dropFinder.title')}
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">{t('dropFinder.description')}</p>
      </div>

      <LootBrowser
        footer={({
          selectedDrops,
          difficulty,
          dungeonDiff,
          upgradeLevel,
          upgradeTracks,
          hasSelection,
        }: LootBrowserRenderState) => {
          const buildPayload = () => {
            if (!hasSelection) return null;
            const dropItems: DropItemPayload[] = selectedDrops.map((item) => {
              const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
              // No `slot_inherits` here: backend derives enchant/gem inheritance
              // from the equipped profile, keeping sim semantics off the frontend.
              return {
                ...item,
                ilevel: resolved.ilvl,
                quality: resolved.quality,
                bonus_ids: [
                  ...(resolved.bonus_id ? [resolved.bonus_id] : []),
                  ...(item.extra_bonus_ids ?? []),
                ],
              };
            });
            return { simc_input: simcInput, drop_items: dropItems, compute_provider: compute };
          };
          return (
            <DropFinderFooter
              buildPayload={buildPayload}
              hasSelection={hasSelection}
              hasCharacter={hasInput}
              count={selectedDrops.length}
              compute={compute}
              onComputeChange={setCompute}
            />
          );
        }}
      />
    </div>
  );
}
