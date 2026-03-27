'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import FloatingSubmitButton from '../components/FloatingSubmitButton';
import { useSimContext } from '../components/SimContext';
import TopGearItemSelector from '../components/TopGearItemSelector';
import { API_URL } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import type { ResolveGearResponse } from '../lib/types';

export default function TopGearPage() {
  const { simcInput, maxCombinations, scenarios } = useSimContext();
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  const [localItems, setLocalItems] = useState<
    { slot: string; simc_string: string; origin: string }[]
  >([]);
  const [maxUpgrade, setMaxUpgrade] = useState(false);
  const [copyEnchants, setCopyEnchants] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [comboError, setComboError] = useState('');
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);

  // Resolve gear when simc input or maxUpgrade changes
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

  // Fetch combo count whenever selection changes
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

  const buildPayload = useCallback(
    () => ({
      simc_input: buildSubmitInput(),
      selected_items: buildSelectedUidsJson(),
      items_by_slot: null,
      max_upgrade: maxUpgrade,
      copy_enchants: copyEnchants,
      ...(maxCombinations != null ? { max_combinations: maxCombinations } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simcInput, localItems, selectedUids, maxUpgrade, copyEnchants, maxCombinations]
  );

  const validate = useCallback(() => {
    if (!resolved) return 'No gear resolved';
    return null;
  }, [resolved]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/top-gear/sim',
    buildPayload,
    validate,
  });

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

      <ErrorAlert message={error} />

      <button
        onClick={submit}
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
        ) : (
          buttonLabel('Find Top Gear')
        )}
      </button>

      <FloatingSubmitButton
        onClick={submit}
        submitting={submitting}
        label={buttonLabel('Find Top Gear')}
      />
    </div>
  );
}
