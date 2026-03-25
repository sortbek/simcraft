"use client";

import { useEffect, useRef, useState } from "react";
import { useSimContext } from "../components/SimContext";
import TopGearItemSelector from "../components/TopGearItemSelector";
import { API_URL } from "../lib/api";
import type { ResolveGearResponse, GEAR_SLOTS } from "../lib/types";

export default function TopGearPage() {
  const { simcInput, fightStyle, threads, maxCombinations, selectedTalent, targetCount, fightLength, customApl, simcHeader, simcBasePlayer, simcRaidActors, simcPostCombos, simcFooter } = useSimContext();
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  // Items added locally via the upgrade copy feature (not in the original simc input)
  const [localItems, setLocalItems] = useState<{ slot: string; simc_string: string; origin: string }[]>([]);
  const [maxUpgrade, setMaxUpgrade] = useState(false);
  const [copyEnchants, setCopyEnchants] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [comboError, setComboError] = useState("");
  const prevInputRef = useRef("");
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

    const timer = setTimeout(async () => {
      prevInputRef.current = trimmed;
      prevUpgradeRef.current = maxUpgrade;
      setResolving(true);
      try {
        const res = await fetch(`${API_URL}/api/gear/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    }, inputChanged ? 300 : 0); // No debounce for upgrade toggle
    return () => clearTimeout(timer);
  }, [simcInput, maxUpgrade]);

  function buildSubmitInput(): string {
    let result = simcInput;
    if (localItems.length > 0) {
      const vaultItems = localItems.filter(li => li.origin === "vault");
      const bagItems = localItems.filter(li => li.origin !== "vault");

      if (vaultItems.length > 0) {
        const vaultLines = vaultItems.map(li => `# ${li.slot}=${li.simc_string}`).join("\n");
        const endMarker = "### End of Weekly Reward Choices";
        if (result.includes(endMarker)) {
          result = result.replace(endMarker, vaultLines + "\n" + endMarker);
        } else {
          result = result + "\n" + vaultLines;
        }
      }
      if (bagItems.length > 0) {
        const bagLines = bagItems.map(li => `# ${li.slot}=${li.simc_string}`).join("\n");
        result = result + "\n" + bagLines;
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
    const hasSelection = Object.values(selectedUids).some(s => s.size > 0);
    if (!resolved || !hasSelection) {
      setComboCount(0);
      setComboError("");
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/top-gear/combo-count`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            simc_input: buildSubmitInput(),
            selected_items: buildSelectedUidsJson(),
            items_by_slot: null,
            max_upgrade: maxUpgrade,
            copy_enchants: copyEnchants,
            max_combinations: maxCombinations,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setComboCount(0);
          setComboError("Failed to calculate combinations. Try selecting fewer items.");
          return;
        }
        const data = await res.json();
        setComboCount(data.combo_count ?? 0);
        setComboError(data.error ?? "");
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          setComboCount(0);
          setComboError("Failed to calculate combinations. Try selecting fewer items.");
        }
      }
    })();

    return () => { controller.abort(); };
  }, [selectedUids, resolved, localItems, maxUpgrade, copyEnchants, maxCombinations]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!resolved) return;
    setError("");
    setSubmitting(true);
    try {
      const selectedUidsJson = buildSelectedUidsJson();
      const submitInput = buildSubmitInput();

      const res = await fetch(`${API_URL}/api/top-gear/sim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simc_input: submitInput,
          selected_items: selectedUidsJson,
          items_by_slot: null,
          iterations: 10000,
          fight_style: fightStyle,
          target_error: 0.1,
          desired_targets: targetCount,
          max_time: fightLength,
          max_upgrade: maxUpgrade,
          copy_enchants: copyEnchants,
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
      setError(err instanceof Error ? err.message : "Failed to submit sim");
    } finally {
      setSubmitting(false);
    }
  }

  if (!resolved) {
    return (
      <p className="text-sm text-muted text-center py-6">
        {resolving
          ? "Resolving gear..."
          : "Paste your SimC addon export above to see gear options."}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-5 flex flex-col sm:flex-row gap-4">
        <label className="flex items-center gap-3 cursor-pointer group flex-1">
          <div
            className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
              copyEnchants ? "bg-gold" : "bg-surface-2 border border-border"
            }`}
            onClick={() => setCopyEnchants(!copyEnchants)}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                copyEnchants ? "left-[18px] bg-black" : "left-0.5 bg-gray-500"
              }`}
            />
          </div>
          <div>
            <span className="text-[13px] font-medium text-gray-300 group-hover:text-white transition-colors">
              Copy Enchants
            </span>
            <p className="text-[11px] text-gray-600">
              Apply equipped enchants to alternatives
            </p>
          </div>
        </label>
        <label className="flex items-center gap-3 cursor-pointer group flex-1">
          <div
            className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
              maxUpgrade ? "bg-gold" : "bg-surface-2 border border-border"
            }`}
            onClick={() => setMaxUpgrade(!maxUpgrade)}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                maxUpgrade ? "left-[18px] bg-black" : "left-0.5 bg-gray-500"
              }`}
            />
          </div>
          <div>
            <span className="text-[13px] font-medium text-gray-300 group-hover:text-white transition-colors">
              Sim Highest Upgrade
            </span>
            <p className="text-[11px] text-gray-600">
              Simulate all items at max upgrade level
            </p>
          </div>
        </label>
      </div>

      <TopGearItemSelector
        resolved={resolved}
        selectedUids={selectedUids}
        onSelectionChange={setSelectedUids}
        onResolvedChange={setResolved}
        onItemAdded={(slot, simcString, origin) => setLocalItems(prev => [...prev, { slot, simc_string: simcString, origin }])}
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
        className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Starting sim…
          </>
        ) : "Find Top Gear"}
      </button>

      {/* Sticky side button */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="group fixed right-4 top-1/2 -translate-y-1/2 z-[90] btn-primary w-10 hover:w-auto py-2.5 px-2.5 hover:px-4 text-sm rounded-full hover:rounded-xl shadow-lg shadow-black/50 flex items-center gap-0 hover:gap-2 transition-all duration-200 overflow-hidden"
      >
        {submitting ? (
          <svg className="w-4 h-4 shrink-0 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2l10 6-10 6V2z" />
          </svg>
        )}
        <span className="whitespace-nowrap max-w-0 group-hover:max-w-[10rem] overflow-hidden transition-all duration-200 opacity-0 group-hover:opacity-100">
          {submitting ? "Starting sim…" : "Find Top Gear"}
        </span>
      </button>
    </div>
  );
}

