'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from '../components/SimContext';
import TopGearItemSelector from '../components/TopGearItemSelector';
import { API_URL } from '../lib/api';
import { storeScenarioSiblings, clearScenarioSiblings } from '../lib/scenario-siblings';
import type { ResolveGearResponse, GEAR_SLOTS } from '../lib/types';

export default function TopGearPage() {
  const {
    simcInput,
    fightStyle,
    threads,
    maxCombinations,
    selectedTalent,
    targetCount,
    fightLength,
    customApl,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    scenarios,
    clearScenarios,
  } = useSimContext();
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  // Items added locally via the upgrade copy feature (not in the original simc input)
  const [localItems, setLocalItems] = useState<
    { slot: string; simc_string: string; origin: string }[]
  >([]);
  const [maxUpgrade, setMaxUpgrade] = useState(false);
  const [copyEnchants, setCopyEnchants] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [comboError, setComboError] = useState('');
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);

  // Call /api/gear/resolve when simc input or maxUpgrade changes
  useEffect(() => {
    const trimmed = simcInput.trim();
    const inputChanged = trimmed !== prevInputRef.current;
    const upgradeChanged = maxUpgrade !== prevUpgradeRef.current;

    if (!inputChanged && !upgradeChanged) return;

    if (trimmed.length < 10) {
      setResolved(null);
      setSelectedUids({});
      prevInputRef.current = trimmed;
      prevUpgradeRef.current = maxUpgrade;
      return;
    }

    const timer = setTimeout(
      async () => {
        prevInputRef.current = trimmed;
        prevUpgradeRef.current = maxUpgrade;
        setResolving(true);
        try {
          const res = await fetch(`${API_URL}/api/gear/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ simc_input: simcInput, max_upgrade: maxUpgrade }),
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

          // Only clear selection and local items when the input changes, not when upgrade toggles
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
    ); // No debounce for upgrade toggle
    return () => clearTimeout(timer);
  }, [simcInput, maxUpgrade]);

  function buildSubmitInput(): string {
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
  }

  function buildSelectedUidsJson(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [slot, uids] of Object.entries(selectedUids)) {
      if (uids.size > 0) {
        result[slot] = [...uids];
      }
    }
    return result;
  }

  // Fetch combo count from backend whenever selection changes
  useEffect(() => {
    const hasSelection = Object.values(selectedUids).some((s) => s.size > 0);
    if (!resolved || !hasSelection) {
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
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setComboCount(0);
          setComboError('Failed to calculate combinations. Try selecting fewer items.');
          return;
        }
        const data = await res.json();
        setComboCount(data.combo_count ?? 0);
        setComboError(data.error ?? '');
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          setComboCount(0);
          setComboError('Failed to calculate combinations. Try selecting fewer items.');
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [selectedUids, resolved, localItems, maxUpgrade, copyEnchants, maxCombinations]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!resolved) return;
    setError('');
    setSubmitting(true);
    clearScenarioSiblings();
    try {
      const selectedUidsJson = buildSelectedUidsJson();
      const submitInput = buildSubmitInput();

      const configs =
        scenarios.length > 0 ? scenarios : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = scenarios.length > 0 ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        simc_input: submitInput,
        selected_items: selectedUidsJson,
        items_by_slot: null,
        iterations: 10000,
        target_error: 0.1,
        max_upgrade: maxUpgrade,
        copy_enchants: copyEnchants,
        ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
        threads,
        ...(batchId ? { batch_id: batchId } : {}),
        ...(selectedTalent ? { talents: selectedTalent } : {}),
        ...(customApl ? { custom_apl: customApl } : {}),
        ...(simcHeader ? { simc_header: simcHeader } : {}),
        ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
        ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
        ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
        ...(simcFooter ? { simc_footer: simcFooter } : {}),
      };

      const results = await Promise.allSettled(
        configs.map(async (config) => {
          const res = await fetch(`${API_URL}/api/top-gear/sim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedPayload,
              fight_style: config.fightStyle,
              desired_targets: config.targetCount,
              max_time: config.fightLength,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || `Server error ${res.status}`);
          }
          return res.json();
        })
      );

      if (scenarios.length === 0) {
        const r = results[0];
        if (r.status === 'fulfilled') {
          window.location.href = `/sim/${r.value.id}`;
        } else {
          throw r.reason;
        }
      } else {
        const siblings = configs
          .map((config, i) => {
            const r = results[i];
            return r.status === 'fulfilled'
              ? {
                  id: r.value.id,
                  fightStyle: config.fightStyle,
                  targetCount: config.targetCount,
                  fightLength: config.fightLength,
                }
              : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        if (siblings.length > 0) {
          storeScenarioSiblings(siblings);
          clearScenarios();
          window.location.href = `/sim/${siblings[0].id}`;
        } else {
          throw new Error('All scenario submissions failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit sim');
    } finally {
      setSubmitting(false);
    }
  }

  if (!resolved) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        {resolving
          ? 'Resolving gear...'
          : 'Paste your SimC addon export above to see gear options.'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row">
        <label className="group flex flex-1 cursor-pointer items-center gap-3">
          <div
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              copyEnchants ? 'bg-gold' : 'border border-border bg-surface-2'
            }`}
            onClick={() => setCopyEnchants(!copyEnchants)}
          >
            <div
              className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                copyEnchants ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
              }`}
            />
          </div>
          <div>
            <span className="text-[13px] font-medium text-gray-300 transition-colors group-hover:text-white">
              Copy Enchants
            </span>
            <p className="text-[11px] text-gray-600">Apply equipped enchants to alternatives</p>
          </div>
        </label>
        <label className="group flex flex-1 cursor-pointer items-center gap-3">
          <div
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              maxUpgrade ? 'bg-gold' : 'border border-border bg-surface-2'
            }`}
            onClick={() => setMaxUpgrade(!maxUpgrade)}
          >
            <div
              className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                maxUpgrade ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
              }`}
            />
          </div>
          <div>
            <span className="text-[13px] font-medium text-gray-300 transition-colors group-hover:text-white">
              Sim Highest Upgrade
            </span>
            <p className="text-[11px] text-gray-600">Simulate all items at max upgrade level</p>
          </div>
        </label>
      </div>

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

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
      >
        {submitting ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path
                d="M14 8a6 6 0 00-6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Starting sim…
          </>
        ) : scenarios.length > 0 ? (
          `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''}`
        ) : (
          'Find Top Gear'
        )}
      </button>

      {/* Sticky side button */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="btn-primary group fixed right-4 top-1/2 z-[90] flex w-10 -translate-y-1/2 items-center gap-0 overflow-hidden rounded-full px-2.5 py-2.5 text-sm shadow-lg shadow-black/50 transition-all duration-200 hover:w-auto hover:gap-2 hover:rounded-xl hover:px-4"
      >
        {submitting ? (
          <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              d="M14 8a6 6 0 00-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2l10 6-10 6V2z" />
          </svg>
        )}
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100">
          {submitting
            ? 'Starting sim…'
            : scenarios.length > 0
              ? `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''}`
              : 'Find Top Gear'}
        </span>
      </button>
    </div>
  );
}
