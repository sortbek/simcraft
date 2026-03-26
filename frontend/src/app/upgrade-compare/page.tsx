"use client";

import { useEffect, useMemo, useState } from "react";
import { useSimContext } from "../components/SimContext";
import { API_URL } from "../lib/api";
import {
  GEAR_SLOTS,
  SLOT_LABELS,
  parseAddonString,
  parseUpgradeCurrencies,
  type ParsedItem,
} from "../lib/parseAddonString";
import {
  QUALITY_COLORS,
  getIconUrl,
  useCurrencyInfo,
  useItemInfo,
  type CurrencyInfo,
} from "../lib/useItemInfo";

type CurrencyMap = Record<number, number>;

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
  cumulative_costs?: Record<string, number>;
}

interface UpgradeCandidate {
  slot: string;
  item: ParsedItem;
  target: UpgradeOption;
  costs: CurrencyMap;
  upgradeChoices: Array<{ target: UpgradeOption; costs: CurrencyMap }>;
}

interface CandidateGroup {
  currencyId: number;
  currencyName: string;
  candidates: UpgradeCandidate[];
}

function toCostMap(costs?: Record<string, number>): CurrencyMap {
  const out: CurrencyMap = {};
  if (!costs) return out;
  for (const [k, v] of Object.entries(costs)) {
    const cid = Number(k);
    if (Number.isFinite(cid) && cid > 0 && v > 0) {
      out[cid] = v;
    }
  }
  return out;
}

function formatCosts(
  costs: CurrencyMap,
  currencyInfo?: Record<number, CurrencyInfo>,
): string {
  const entries = Object.entries(costs).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  if (entries.length === 0) return "no cost";
  return entries
    .map(([currencyId, amount]) => {
      const name = currencyInfo?.[Number(currencyId)]?.name;
      return name ? `${name} x${amount}` : `${currencyId}x${amount}`;
    })
    .join(", ");
}

export default function UpgradeComparePage() {
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
  } = useSimContext();

  const [currencies, setCurrencies] = useState<CurrencyMap>({});
  const [candidates, setCandidates] = useState<UpgradeCandidate[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverComboCount, setServerComboCount] = useState(0);
  const [error, setError] = useState("");

  const infoQueries = useMemo(
    () =>
      candidates.map((c) => ({
        item_id: c.item.item_id,
        bonus_ids: c.item.bonus_ids,
      })),
    [candidates],
  );
  const itemInfo = useItemInfo(infoQueries);
  const currencyIds = useMemo(
    () => Object.keys(currencies).map(Number),
    [currencies],
  );
  const currencyInfo = useCurrencyInfo(currencyIds);
  const dawncrestCurrencyIdSet = useMemo(() => {
    const ids = Object.values(currencyInfo)
      .filter((info) => info.name.toLowerCase().includes("dawncrest"))
      .map((info) => info.currency_id);
    return new Set(ids);
  }, [currencyInfo]);

  const dawncrestCurrencyKey = useMemo(
    () => [...dawncrestCurrencyIdSet].sort((a, b) => a - b).join(","),
    [dawncrestCurrencyIdSet],
  );

  const dawncrestCurrencyEntries = useMemo(
    () =>
      Object.entries(currencies)
        .filter(([currencyId]) =>
          dawncrestCurrencyIdSet.has(Number(currencyId)),
        )
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    [currencies, dawncrestCurrencyIdSet],
  );

  const candidateGroups = useMemo(() => {
    const groups = new Map<number, UpgradeCandidate[]>();
    for (const candidate of candidates) {
      const dawncrestCurrencyIds = Object.keys(candidate.costs)
        .map(Number)
        .filter((cid) => dawncrestCurrencyIdSet.has(cid))
        .sort((a, b) => a - b);
      if (dawncrestCurrencyIds.length === 0) continue;
      const currencyId = dawncrestCurrencyIds[0];
      const existing = groups.get(currencyId) || [];
      existing.push(candidate);
      groups.set(currencyId, existing);
    }

    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([currencyId, groupedCandidates]) => ({
        currencyId,
        currencyName:
          currencyInfo[currencyId]?.name || `Currency ${currencyId}`,
        candidates: groupedCandidates,
      })) as CandidateGroup[];
  }, [candidates, dawncrestCurrencyIdSet, currencyInfo]);

  useEffect(() => {
    const trimmed = simcInput.trim();

    setError("");
    setCurrencies(parseUpgradeCurrencies(simcInput));

    if (trimmed.length < 10) {
      setCandidates([]);
      setSelectedSlots(new Set());
      setServerComboCount(0);
      return;
    }

    const parsed = parseAddonString(simcInput);
    const equippedBySlot: Array<{ slot: string; item: ParsedItem }> = [];

    for (const slot of GEAR_SLOTS) {
      const eq = parsed[slot]?.find((item) => item.is_equipped);
      if (eq && eq.bonus_ids.length > 0) {
        equippedBySlot.push({ slot, item: eq });
      }
    }

    if (equippedBySlot.length === 0) {
      setCandidates([]);
      setSelectedSlots(new Set());
      setServerComboCount(0);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    Promise.all(
      equippedBySlot.map(async ({ slot, item }) => {
        const res = await fetchWithTimeout(
          `${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(",")}`,
        );
        if (!res.ok) return null;

        const data = await res.json();
        const options: UpgradeOption[] = data.options || [];
        if (!Array.isArray(options) || options.length === 0) return null;

        const current = options.find((opt) =>
          item.bonus_ids.includes(opt.bonus_id),
        );
        if (!current) return null;

        const dawncrestHigher = options
          .filter((opt) => {
            if (opt.level <= current.level) return false;
            const costs = opt.cumulative_costs || {};
            return Object.keys(costs).some((cid) =>
              dawncrestCurrencyIdSet.has(Number(cid)),
            );
          })
          .sort((a, b) => a.level - b.level);

        if (dawncrestHigher.length === 0) return null;

        const upgradeChoices = dawncrestHigher.map((opt) => ({
          target: opt,
          costs: toCostMap(opt.cumulative_costs),
        }));
        const target = dawncrestHigher[dawncrestHigher.length - 1];
        return {
          slot,
          item,
          target,
          costs: toCostMap(target.cumulative_costs),
          upgradeChoices,
        } as UpgradeCandidate;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const filtered = results.filter(
          (r): r is UpgradeCandidate => r !== null,
        );
        setCandidates(filtered);
        setSelectedSlots(new Set());
      })
      .catch(() => {
        if (!cancelled) {
          setCandidates([]);
          setSelectedSlots(new Set());
          setServerComboCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [simcInput, dawncrestCurrencyKey]);

  useEffect(() => {
    if (!simcInput.trim()) {
      setServerComboCount(0);
      return;
    }

    if (selectedSlots.size === 0 || candidates.length === 0) {
      setServerComboCount(0);
      return;
    }

    let cancelled = false;
    const selected = [...selectedSlots];

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/upgrade-compare/combo-count`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            simc_input: simcInput,
            selected_slots: selected,
            max_combinations: maxCombinations,
            ...(selectedTalent ? { talents: selectedTalent } : {}),
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          setServerComboCount(0);
          return;
        }

        setServerComboCount(
          typeof data.combo_count === "number" ? data.combo_count : 0,
        );
      } catch {
        if (!cancelled) {
          setServerComboCount(0);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    simcInput,
    selectedSlots,
    candidates.length,
    maxCombinations,
    selectedTalent,
  ]);

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const selected = [...selectedSlots];
      if (selected.length === 0) {
        throw new Error("Select at least one upgradeable item.");
      }

      const res = await fetch(`${API_URL}/api/upgrade-compare/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simc_input: simcInput,
          selected_slots: selected,
          iterations: 10000,
          fight_style: fightStyle,
          target_error: 0.1,
          desired_targets: targetCount,
          max_time: fightLength,
          max_combinations: maxCombinations,
          threads,
          ...(selectedTalent ? { talents: selectedTalent } : {}),
          ...(customApl ? { custom_apl: customApl } : {}),
          ...(simcHeader ? { simc_header: simcHeader } : {}),
          ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
          ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
          ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
          ...(simcFooter ? { simc_footer: simcFooter } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      window.location.href = `/sim/${data.id}`;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to start simulation",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const hasDawncrestCurrencies = dawncrestCurrencyEntries.length > 0;

  const toggleCurrencyGroup = (group: CandidateGroup) => {
    const groupSlots = group.candidates.map((c) => c.slot);
    const allSelected = groupSlots.every((slot) => selectedSlots.has(slot));
    const next = new Set(selectedSlots);
    if (allSelected) {
      for (const slot of groupSlots) next.delete(slot);
    } else {
      for (const slot of groupSlots) next.add(slot);
    }
    setSelectedSlots(next);
  };

  if (!simcInput.trim()) {
    return (
      <p className="text-sm text-muted text-center py-6">
        Paste your SimC addon export above to begin.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <p className="text-xs font-medium uppercase tracking-widest text-muted mb-3">
          Upgrade Currencies
        </p>
        {!hasDawncrestCurrencies ? (
          <p className="text-sm text-muted">
            No Dawncrest currencies found in your SimC export.
          </p>
        ) : (
          <div className="space-y-2">
            {dawncrestCurrencyEntries.map(([currencyId, amount]) => {
              const info = currencyInfo[Number(currencyId)];
              return (
                <div
                  key={currencyId}
                  className="rounded-md bg-surface-2 border border-border px-3 py-2 text-sm flex items-center gap-2"
                >
                  <img
                    src={getIconUrl(info?.icon || "inv_misc_questionmark")}
                    alt=""
                    width={24}
                    height={24}
                    className="w-6 h-6 rounded flex-shrink-0"
                  />
                  <span className="text-gray-300 truncate flex-1">
                    {info?.name || `Currency ${currencyId}`}
                  </span>
                  <span className="font-mono tabular-nums text-white">
                    {amount.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Upgradeable Equipped Items
          </p>
          <span className="text-xs text-muted">
            {serverComboCount} valid combos
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading upgrade options...</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted">
            No Dawncrest-upgradeable equipped items found.
          </p>
        ) : (
          <div className="space-y-4">
            {candidateGroups.map((group) => {
              const groupSlots = group.candidates.map((c) => c.slot);
              const allSelected =
                groupSlots.length > 0 &&
                groupSlots.every((slot) => selectedSlots.has(slot));

              return (
                <div key={group.currencyId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted">
                      {group.currencyName}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleCurrencyGroup(group)}
                      className="text-xs px-2 py-1 rounded border border-border bg-surface-2 hover:border-gold/40"
                    >
                      {allSelected ? "Deselect all" : "Select all"}
                    </button>
                  </div>

                  {group.candidates.map((candidate) => {
                    const checked = selectedSlots.has(candidate.slot);
                    const info = itemInfo[candidate.item.item_id];
                    const quality = info
                      ? QUALITY_COLORS[info.quality] || "#fff"
                      : "#fff";
                    const icon = info?.icon || "inv_misc_questionmark";
                    const name =
                      info?.name ||
                      candidate.item.name ||
                      `Item ${candidate.item.item_id}`;
                    return (
                      <label
                        key={candidate.slot}
                        className={`flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer ${
                          checked
                            ? "border-gold/50 bg-gold/[0.05]"
                            : "border-border bg-surface-2"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedSlots);
                            if (checked) next.delete(candidate.slot);
                            else next.add(candidate.slot);
                            setSelectedSlots(next);
                          }}
                        />
                        <img
                          src={getIconUrl(icon)}
                          alt=""
                          width={28}
                          height={28}
                          className="w-7 h-7 rounded"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm truncate"
                            style={{ color: quality }}
                          >
                            {SLOT_LABELS[candidate.slot] || candidate.slot}:{" "}
                            {name}
                          </p>
                          <p className="text-[11px] text-muted">
                            {candidate.item.ilevel}
                            {" -> "}
                            {candidate.target.itemLevel} |{" "}
                            {formatCosts(candidate.costs, currencyInfo)}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={
          submitting || candidates.length === 0 || !hasDawncrestCurrencies
        }
        className="btn-primary w-full py-3 text-sm"
      >
        {submitting ? "Starting sim..." : "Sim Upgrade Combinations"}
      </button>
    </div>
  );
}
