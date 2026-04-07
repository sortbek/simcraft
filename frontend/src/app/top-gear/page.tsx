'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import { useSimContext } from '../components/sim-config/SimContext';
import TopGearItemSelector from '../components/gear/TopGearItemSelector';
import TalentPicker from '../components/talents/TalentPicker';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { ResolveGearResponse } from '../lib/types';
import { useLanguage } from '../lib/i18n';

function Toggle({
  checked,
  onChange,
  label,
  color = 'bg-primary',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  color?: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 cursor-pointer group"
      onClick={() => onChange(!checked)}
    >
      <div
        className={`w-9 h-5 rounded-full relative p-1 transition-colors shrink-0 ${
          checked ? color : 'bg-surface-container-highest'
        }`}
      >
        <div
          className={`w-3 h-3 rounded-full absolute transition-all ${
            checked ? 'right-1 bg-on-surface' : 'left-1 bg-on-surface-variant'
          }`}
        />
      </div>
      <span className="text-sm font-headline font-bold text-on-surface-variant group-hover:text-primary transition-colors">
        {label}
      </span>
    </div>
  );
}

export default function TopGearPage() {
  const { simcInput, maxCombinations, scenarios, talentBuilds } = useSimContext();
  const { t } = useLanguage();
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  const [localItems, setLocalItems] = useState<
    { slot: string; simc_string: string; origin: string }[]
  >([]);
  const [maxUpgrade, setMaxUpgrade] = useState(false);
  const [copyEnchants, setCopyEnchants] = useState(true);
  const [catalyst, setCatalyst] = useState(false);
  const [catalystCharges, setCatalystCharges] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [comboError, setComboError] = useState('');
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);
  const prevCatalystRef = useRef(false);

  useEffect(() => {
    const trimmed = simcInput.trim();
    const inputChanged = trimmed !== prevInputRef.current;
    const upgradeChanged = maxUpgrade !== prevUpgradeRef.current;
    const catalystChanged = catalyst !== prevCatalystRef.current;

    if (!inputChanged && !upgradeChanged && !catalystChanged) return;

    if (trimmed.length < 10) {
      setResolved(null);
      setSelectedUids({});
      prevInputRef.current = trimmed;
      prevUpgradeRef.current = maxUpgrade;
      prevCatalystRef.current = catalyst;
      return;
    }

    const timer = setTimeout(
      async () => {
        prevInputRef.current = trimmed;
        prevUpgradeRef.current = maxUpgrade;
        prevCatalystRef.current = catalyst;
        setResolving(true);
        try {
          const res = await fetch(`${API_URL}/api/gear/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ simc_input: simcInput, max_upgrade: maxUpgrade, catalyst }),
          });
          if (!res.ok) {
            setResolved(null);
            setSelectedUids({});
            return;
          }
          const data: ResolveGearResponse = await res.json();

          const hasAlternatives = Object.values(data.slots).some(
            (slot) => slot.alternatives.length > 0
          );
          if (!hasAlternatives) {
            setResolved(null);
            setSelectedUids({});
            setLocalItems([]);
            return;
          }

          setResolved(data);

          if (inputChanged && data.catalyst_charges != null) {
            setCatalystCharges(data.catalyst_charges);
          }

          if (inputChanged) {
            setSelectedUids({});
            setLocalItems([]);
          }
        } catch {
          setResolved(null);
          setSelectedUids({});
        } finally {
          setResolving(false);
        }
      },
      inputChanged ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [simcInput, maxUpgrade, catalyst]);

  const buildSubmitInput = useCallback((): string => {
    let result = simcInput;
    if (localItems.length > 0) {
      const vaultItems = localItems.filter((li) => li.origin === 'vault');
      const bagItems = localItems.filter((li) => li.origin !== 'vault');

      if (vaultItems.length > 0) {
        const vaultLines = vaultItems.map((li) => `# ${li.slot}=${li.simc_string}`).join('\n');
        const endMarker = '### End of Weekly Reward Choices';
        if (result.includes(endMarker)) {
          result = result.replace(endMarker, vaultLines + '\n' + endMarker);
        } else {
          result = result + '\n' + vaultLines;
        }
      }
      if (bagItems.length > 0) {
        const bagLines = bagItems.map((li) => `# ${li.slot}=${li.simc_string}`).join('\n');
        result = result + '\n' + bagLines;
      }
    }
    return result;
  }, [simcInput, localItems]);

  const buildSelectedUidsJson = useCallback((): Record<string, string[]> => {
    const result: Record<string, string[]> = {};
    for (const [slot, uids] of Object.entries(selectedUids)) {
      if (uids.size > 0) {
        result[slot] = [...uids];
      }
    }
    return result;
  }, [selectedUids]);

  useEffect(() => {
    const hasGearSelection = Object.values(selectedUids).some((s) => s.size > 0);
    const hasTalentCompare = talentBuilds.length > 1;
    if (!resolved || (!hasGearSelection && !hasTalentCompare)) {
      setComboCount(0);
      setComboError('');
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/top-gear/combo-count`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: buildSubmitInput(),
            selected_items: buildSelectedUidsJson(),
            items_by_slot: null,
            max_upgrade: maxUpgrade,
            copy_enchants: copyEnchants,
            ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
            ...(talentBuilds.length > 1
              ? {
                  talent_builds: talentBuilds.map((tb) => ({
                    name: tb.name,
                    talent_string: tb.talentString,
                  })),
                }
              : {}),
            catalyst,
            ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setComboCount(0);
          setComboError(t('validation.tooManyCombinations'));
          return;
        }
        const data = await res.json();
        setComboCount(data.combo_count ?? 0);
        setComboError(data.error ?? '');
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          setComboCount(0);
          setComboError(t('validation.tooManyCombinations'));
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    selectedUids,
    resolved,
    localItems,
    maxUpgrade,
    copyEnchants,
    maxCombinations,
    talentBuilds,
    catalyst,
    catalystCharges,
    buildSelectedUidsJson,
    buildSubmitInput,
    t,
  ]);

  const buildPayload = useCallback(
    () => ({
      simc_input: buildSubmitInput(),
      selected_items: buildSelectedUidsJson(),
      items_by_slot: null,
      max_upgrade: maxUpgrade,
      copy_enchants: copyEnchants,
      ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
      ...(talentBuilds.length > 1
        ? {
            talent_builds: talentBuilds.map((tb) => ({
              name: tb.name,
              talent_string: tb.talentString,
            })),
          }
        : {}),
      catalyst,
      ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
    }),
    [
      buildSubmitInput,
      buildSelectedUidsJson,
      maxUpgrade,
      copyEnchants,
      maxCombinations,
      talentBuilds,
      catalyst,
      catalystCharges,
    ]
  );

  const validate = useCallback(() => {
    if (!resolved) return t('validation.noGearResolved');
    return null;
  }, [resolved, t]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/top-gear/sim',
    buildPayload,
    validate,
  });

  return (
    <div className="space-y-6 pb-20">
      <TalentPicker />

      {/* Top Gear toggles */}
      <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 px-6 py-4 flex flex-wrap items-center gap-6">
        <Toggle checked={copyEnchants} onChange={setCopyEnchants} label={t('topGear.copyEnchants')} />
        <span className="h-5 w-px bg-outline-variant/20" />
        <Toggle checked={maxUpgrade} onChange={setMaxUpgrade} label={t('topGear.simHighestUpgrade')} />
        {catalystCharges != null && catalystCharges > 0 && (
          <>
            <span className="h-5 w-px bg-outline-variant/20" />
            <div className="flex items-center gap-2.5">
              <Toggle checked={catalyst} onChange={setCatalyst} label={t('topGear.revivalCatalyst')} color="bg-purple-500" />
              <div className="flex items-center gap-1.5 ml-1">
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={catalystCharges}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0) setCatalystCharges(v);
                  }}
                  className="input-field !w-12 !px-1.5 !py-0.5 text-center !text-[13px]"
                />
                <span className="text-[11px] text-on-surface-variant/60">{t('topGear.charges')}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {!resolved ? (
        <p className="py-6 text-center text-sm text-muted">
          {resolving
            ? t('topGear.resolvingGear')
            : t('topGear.pasteExport')}
        </p>
      ) : (
        <TopGearItemSelector
          resolved={resolved}
          selectedUids={selectedUids}
          onSelectionChange={setSelectedUids}
          onResolvedChange={setResolved}
          onItemAdded={(slot, simcString, origin) =>
            setLocalItems((prev) => [...prev, { slot, simc_string: simcString, origin }])
          }
          maxUpgrade={maxUpgrade}
          comboCount={comboCount}
          comboError={comboError}
        />
      )}

      <ErrorAlert message={error} />

      <ConfigFooter
        onSubmit={submit}
        submitting={submitting}
        buttonLabel={buttonLabel(t('button.findTopGear'))}
        disabled={!resolved}
      />
    </div>
  );
}
