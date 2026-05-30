'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import EnchantGemSelector from '../components/gear/EnchantGemSelector';
import { useResolvedGear, equippedSlots as mapEquippedSlots } from '../lib/useResolvedGear';
import { useComboCount } from '../lib/useComboCount';
import { useLanguage } from '../lib/i18n';
import { useComputeChoice } from '../lib/useComputeChoice';

export default function EnchantGemPage() {
  const { simcInput, hasInput } = useSimContext();
  const { t } = useLanguage();
  const { resolved, resolving } = useResolvedGear(simcInput, { minLength: 50 });
  const equippedSlots = useMemo(() => mapEquippedSlots(resolved), [resolved]);
  const [compute, setCompute] = useComputeChoice('enchant_gem');

  // Enchant selections: slot -> Set of enchant_ids
  const [enchantSelections, setEnchantSelections] = useState<Record<string, Set<number>>>({});
  // Gem selections: flat set of gem_item_ids (applied to all sockets)
  const [gemSelections, setGemSelections] = useState<Set<number>>(new Set());

  // Reset selections when gear changes
  useEffect(() => {
    setEnchantSelections({});
    setGemSelections(new Set());
  }, [equippedSlots]);

  // Convert selections to serializable form for API
  const enchantSelectionsArray = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const [slot, ids] of Object.entries(enchantSelections)) {
      if (ids.size > 0) result[slot] = Array.from(ids);
    }
    return result;
  }, [enchantSelections]);

  const gemOptionsArray = useMemo(() => Array.from(gemSelections), [gemSelections]);

  const hasSelections =
    Object.values(enchantSelectionsArray).some((arr) => arr.length > 0) ||
    gemOptionsArray.length > 0;

  const { comboCount } = useComboCount(
    '/api/enchant-gem/combo-count',
    () => ({
      simc_input: simcInput,
      enchant_selections: enchantSelectionsArray,
      gem_options: gemOptionsArray,
    }),
    [enchantSelectionsArray, gemOptionsArray, simcInput],
    { enabled: hasSelections && !!equippedSlots, debounceMs: 200 }
  );

  // Selection handlers
  const onEnchantToggle = useCallback((slot: string, id: number) => {
    setEnchantSelections((prev) => {
      const next = { ...prev };
      const set = new Set(prev[slot] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      next[slot] = set;
      return next;
    });
  }, []);

  const onGemToggle = useCallback((_slot: string, id: number) => {
    setGemSelections((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return set;
    });
  }, []);

  const onSelectAllEnchants = useCallback((slot: string, ids: number[]) => {
    setEnchantSelections((prev) => ({
      ...prev,
      [slot]: new Set(ids),
    }));
  }, []);

  const onDeselectAllEnchants = useCallback((slot: string) => {
    setEnchantSelections((prev) => ({
      ...prev,
      [slot]: new Set(),
    }));
  }, []);

  const onSelectAllGems = useCallback((_slot: string, ids: number[]) => {
    setGemSelections(new Set(ids));
  }, []);

  const onDeselectAllGems = useCallback((_slot: string) => {
    setGemSelections(new Set());
  }, []);

  // Sim submission
  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      enchant_selections: enchantSelectionsArray,
      gem_options: gemOptionsArray,
      compute_provider: compute,
    }),
    [simcInput, enchantSelectionsArray, gemOptionsArray, compute]
  );

  const validate = useCallback(() => {
    if (!hasInput) return t('validation.simcTooShort');
    if (!hasSelections) return t('enchantGem.noSelectionsError');
    return null;
  }, [hasInput, hasSelections, t]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/enchant-gem/sim',
    buildPayload,
    validate,
  });

  const buttonText =
    comboCount > 0
      ? t('button.findBestEnchants', { count: comboCount })
      : buttonLabel(t('button.findBestEnchantsDefault'));

  return (
    <div className="space-y-6 pb-20">
      <TalentPicker defaultView="view" hideCompare />

      {resolving && (
        <div className="card p-6">
          <p className="text-sm text-on-surface-variant/60">{t('topGear.resolvingGear')}</p>
        </div>
      )}

      {!resolving && !equippedSlots && hasInput && (
        <div className="card p-6">
          <p className="text-sm text-on-surface-variant/60">{t('enchantGem.noGearFound')}</p>
        </div>
      )}

      {!resolving && !equippedSlots && !hasInput && (
        <div className="card p-6">
          <p className="text-sm text-on-surface-variant/60">{t('enchantGem.pasteExport')}</p>
        </div>
      )}

      {equippedSlots && (
        <EnchantGemSelector
          equippedSlots={equippedSlots}
          enchantSelections={enchantSelections}
          gemSelections={gemSelections}
          onEnchantToggle={onEnchantToggle}
          onGemToggle={onGemToggle}
          onSelectAllEnchants={onSelectAllEnchants}
          onDeselectAllEnchants={onDeselectAllEnchants}
          onSelectAllGems={onSelectAllGems}
          onDeselectAllGems={onDeselectAllGems}
          replaceGems={false}
          onReplaceGemsChange={() => {}}
          diamondAlwaysUse={false}
          onDiamondAlwaysUseChange={() => {}}
          maxColors={false}
          onMaxColorsChange={() => {}}
        />
      )}

      {comboCount > 0 && (
        <div className="text-center text-sm text-on-surface-variant/60">
          {t('enchantGem.comboCount', { count: comboCount })}
        </div>
      )}

      <SimcDownloadBanner />
      <ErrorAlert message={error} />
      <ConfigFooter
        onSubmit={submit}
        submitting={submitting}
        buttonLabel={buttonText}
        disabled={!hasInput || !hasSelections}
        compute={compute}
        onComputeChange={setCompute}
      />
    </div>
  );
}
