'use client';

import { useCallback } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useComputeChoice, type ComputeChoice } from '../lib/useComputeChoice';
import LootBrowser from '../components/loot/LootBrowser';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { useLanguage } from '../lib/i18n';
import type { LootSubmission } from '../components/loot/useLootBrowserModel';

interface DropFinderFooterProps {
  buildPayload: () =>
    | (LootSubmission & { simc_input: string; compute_provider: ComputeChoice })
    | null;
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
        footer={(submission) => {
          const hasSelection = submission !== null;
          const buildPayload = () =>
            submission ? { ...submission, simc_input: simcInput, compute_provider: compute } : null;
          return (
            <DropFinderFooter
              buildPayload={buildPayload}
              hasSelection={hasSelection}
              hasCharacter={hasInput}
              count={submission?.drop_items.length ?? 0}
              compute={compute}
              onComputeChange={setCompute}
            />
          );
        }}
      />
    </div>
  );
}
