'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import FloatingSubmitButton from '../components/FloatingSubmitButton';
import GearItemRow from '../components/GearItemRow';
import { useSimContext } from '../components/SimContext';
import { API_URL } from '../lib/api';
import { SLOT_LABELS } from '../lib/types';
import { QUALITY_COLORS, getIconUrl, useItemInfo, type ItemQuery } from '../lib/useItemInfo';
import { useSimSubmit } from '../lib/useSimSubmit';

// ---- Types ----

interface PrepareCandidate {
  slot: string;
  item_id: number;
  bonus_ids: number[];
  ilevel: number;
  target_ilevel: number;
  costs: Record<string, number>;
}

interface CurrencyMeta {
  id: number;
  amount: number;
  name: string;
  icon: string;
}

interface PrepareResponse {
  candidates: PrepareCandidate[];
  currencies: Record<string, CurrencyMeta>;
}

// ---- Helpers ----

function formatCosts(
  costs: Record<string, number>,
  currencies: Record<string, CurrencyMeta>
): string {
  const entries = Object.entries(costs).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (entries.length === 0) return 'no cost';
  return entries
    .map(([cid, amount]) => {
      const name = currencies[cid]?.name;
      return name ? `${name} x${amount}` : `${cid}x${amount}`;
    })
    .join(', ');
}

// ---- Data Hook (single endpoint) ----

function useUpgradeData(simcInput: string) {
  const [data, setData] = useState<PrepareResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < 10) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simc_input: simcInput }),
        });
        if (!res.ok || cancelled) return;
        const result: PrepareResponse = await res.json();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [simcInput]);

  return { data, loading };
}

// ---- Page ----

export default function UpgradeComparePage() {
  const { simcInput, maxCombinations } = useSimContext();

  const { data, loading } = useUpgradeData(simcInput);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [comboCount, setComboCount] = useState(0);

  const candidates = data?.candidates ?? [];
  const currencies = data?.currencies ?? {};
  const hasCurrencies = Object.keys(currencies).length > 0;

  // Reset selection when candidates change
  useEffect(() => {
    setSelectedSlots(new Set());
    setComboCount(0);
  }, [data]);

  // Item info for display
  const infoQueries = useMemo<ItemQuery[]>(
    () => candidates.map((c) => ({ item_id: c.item_id, bonus_ids: c.bonus_ids })),
    [candidates]
  );
  const itemInfo = useItemInfo(infoQueries);

  // Debounced combo count
  const comboTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (selectedSlots.size === 0 || !simcInput.trim()) {
      setComboCount(0);
      return;
    }

    clearTimeout(comboTimer.current);
    comboTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/combo-count`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: simcInput,
            selected_slots: [...selectedSlots],
            max_combinations: maxCombinations,
          }),
        });
        const result = await res.json();
        setComboCount(result.combo_count ?? 0);
      } catch {
        setComboCount(0);
      }
    }, 300);

    return () => clearTimeout(comboTimer.current);
  }, [simcInput, selectedSlots, maxCombinations]);

  // Sim submission
  const buildPayload = useCallback(() => {
    if (selectedSlots.size === 0) return null;
    return {
      simc_input: simcInput,
      selected_slots: [...selectedSlots],
      max_combinations: maxCombinations,
    };
  }, [simcInput, selectedSlots, maxCombinations]);

  const validate = useCallback(() => {
    if (selectedSlots.size === 0) return 'Select at least one upgradeable item.';
    return null;
  }, [selectedSlots]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({ endpoint: '/api/upgrade-compare/sim', buildPayload, validate });

  // Group candidates by primary upgrade currency
  const candidateGroups = useMemo(() => {
    // Find which currencies are actually upgrade currencies (have cost data on candidates)
    const upgradeCurrencyIds = new Set<number>();
    for (const c of candidates) {
      for (const cid of Object.keys(c.costs).map(Number)) {
        if (currencies[String(cid)]) upgradeCurrencyIds.add(cid);
      }
    }

    const groups = new Map<number, PrepareCandidate[]>();
    for (const c of candidates) {
      const cid = Object.keys(c.costs)
        .map(Number)
        .find((id) => upgradeCurrencyIds.has(id));
      if (!cid) continue;
      const list = groups.get(cid) || [];
      list.push(c);
      groups.set(cid, list);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cid, items]) => ({
        currencyId: cid,
        currency: currencies[String(cid)],
        candidates: items,
      }));
  }, [candidates, currencies]);

  const hasCharacter = simcInput.trim().length >= 10;

  const toggleGroup = (groupCandidates: PrepareCandidate[]) => {
    const slots = groupCandidates.map((c) => c.slot);
    const allSelected = slots.every((s) => selectedSlots.has(s));
    const next = new Set(selectedSlots);
    for (const s of slots) {
      if (allSelected) next.delete(s);
      else next.add(s);
    }
    setSelectedSlots(next);
  };

  if (!hasCharacter) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Paste your SimC addon export above to begin.
      </p>
    );
  }

  const submitLabel = !hasCurrencies
    ? 'No upgrade currencies found'
    : selectedSlots.size === 0
      ? 'Select items to upgrade'
      : buttonLabel(`Sim Upgrades (${comboCount} combos)`);

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <div className="rounded-lg border border-border/50 bg-surface-2/50 px-4 py-3">
        <p className="text-[13px] leading-relaxed text-zinc-400">
          Find the best way to spend your{' '}
          <span className="font-medium text-gold/80">Dawncrest upgrade currencies</span>. Select
          which equipped items to consider, and SimHammer will test every valid upgrade combination
          within your budget to find which gives the most DPS.
        </p>
      </div>

      {/* Currency Budget */}
      {hasCurrencies && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
            Budget
          </span>
          {Object.values(currencies)
            .filter((c) => c.name)
            .sort((a, b) => a.id - b.id)
            .map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1"
              >
                <img
                  src={getIconUrl(c.icon || 'inv_misc_questionmark')}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm"
                />
                <span className="text-[11px] text-gray-400">{c.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-white">{c.amount}</span>
              </div>
            ))}
        </div>
      )}

      {/* Upgradeable Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Select Items to Upgrade
          </p>
          {comboCount > 0 && (
            <span className="rounded-md bg-surface-2 px-2.5 py-1 font-mono text-xs text-white">
              {comboCount.toLocaleString()} combo{comboCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <div className="card flex justify-center p-8">
            <svg className="h-6 w-6 animate-spin text-gold" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path
                d="M14 8a6 6 0 00-6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : candidates.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-muted">No upgradeable equipped items found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {candidateGroups.map((group) => {
              const groupSlots = group.candidates.map((c) => c.slot);
              const allSelected =
                groupSlots.length > 0 && groupSlots.every((s) => selectedSlots.has(s));

              return (
                <div key={group.currencyId} className="card space-y-1 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <img
                        src={getIconUrl(group.currency?.icon || 'inv_misc_questionmark')}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-sm"
                      />
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                        {group.currency?.name || `Currency ${group.currencyId}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.candidates)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      {allSelected ? 'Deselect' : 'Select all'}
                    </button>
                  </div>

                  {group.candidates.map((c) => {
                    const info = itemInfo[c.item_id];
                    const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';

                    return (
                      <GearItemRow
                        key={c.slot}
                        icon={info?.icon || 'inv_misc_questionmark'}
                        name={info?.name || `Item ${c.item_id}`}
                        nameColor={qc}
                        details={[
                          { text: SLOT_LABELS[c.slot] || c.slot },
                          { text: `${c.ilevel} → ${c.target_ilevel}` },
                          { text: formatCosts(c.costs, currencies), color: 'text-gold/70' },
                        ]}
                        ilevel={c.ilevel}
                        selectable
                        checked={selectedSlots.has(c.slot)}
                        onToggle={() => {
                          const next = new Set(selectedSlots);
                          if (selectedSlots.has(c.slot)) next.delete(c.slot);
                          else next.add(c.slot);
                          setSelectedSlots(next);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ErrorAlert message={error} />

      <FloatingSubmitButton
        onClick={handleSubmit}
        disabled={submitting || selectedSlots.size === 0 || !hasCurrencies}
        submitting={submitting}
        label={submitLabel}
      />
    </div>
  );
}
