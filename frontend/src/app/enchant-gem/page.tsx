'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import EnchantGemSelector from '../components/gear/EnchantGemSelector';
import { API_URL } from '../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useLanguage } from '../lib/i18n';

function useResolvedGear(simcInput: string) {
  const [slots, setSlots] = useState<Record<string, ResolvedItem> | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < 50) {
      setSlots(null);
      return;
    }
    setResolving(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/gear/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simc_input: simcInput, max_upgrade: false, catalyst: false }),
        });
        if (!res.ok) {
          setSlots(null);
          setResolving(false);
          return;
        }
        const data: ResolveGearResponse = await res.json();
        const map: Record<string, ResolvedItem> = {};
        for (const [slot, resolution] of Object.entries(data.slots)) {
          if (resolution.equipped) {
            map[slot] = resolution.equipped;
          }
        }
        setSlots(Object.keys(map).length > 0 ? map : null);
      } catch {
        setSlots(null);
      } finally {
        setResolving(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [simcInput]);

  return { slots, resolving };
}

export default function EnchantGemPage() {
  const { simcInput, hasInput } = useSimContext();
  const { t } = useLanguage();
  const { slots: equippedSlots, resolving } = useResolvedGear(simcInput);

  // Enchant selections: slot -> Set of enchant_ids
  const [enchantSelections, setEnchantSelections] = useState<Record<string, Set<number>>>({});
  // Gem selections: flat set of gem_item_ids (applied to all sockets)
  const [gemSelections, setGemSelections] = useState<Set<number>>(new Set());
  // Combo count
  const [comboCount, setComboCount] = useState<number | null>(null);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset selections when gear changes
  useEffect(() => {
    setEnchantSelections({});
    setGemSelections(new Set());
    setComboCount(null);
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

  // Fetch combo count when selections change
  useEffect(() => {
    if (!hasSelections || !equippedSlots) {
      setComboCount(null);
      return;
    }
    clearTimeout(comboTimerRef.current);
    comboTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/enchant-gem/combo-count`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: simcInput,
            enchant_selections: enchantSelectionsArray,
            gem_options: gemOptionsArray,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setComboCount(data.combo_count);
        }
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(comboTimerRef.current);
  }, [enchantSelectionsArray, gemOptionsArray, simcInput, hasSelections, equippedSlots]);

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
    }),
    [simcInput, enchantSelectionsArray, gemOptionsArray]
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
    comboCount && comboCount > 0
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

      {comboCount !== null && comboCount > 0 && (
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
      />
    </div>
  );
}
