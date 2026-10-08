'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import PageHeader from '../components/ui/PageHeader';
import Pill from '../components/ui/Pill';
import GearItemRow from '../components/gear/GearItemRow';
import { useSimContext } from '../components/sim-config/SimContext';
import { API_URL } from '../lib/api';
import { useComboCount } from '../lib/useComboCount';
import { SLOT_LABELS } from '../lib/types';
import { QUALITY_COLORS, useItemInfo, type ItemQuery, iconProps } from '../lib/useItemInfo';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import SimSettingsBlock from '../components/sim-config/SimSettingsBlock';
import { useLanguage } from '../lib/i18n';
import { localizedItemName, useItemNames, getWowheadUrl } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useComputeChoice } from '../lib/useComputeChoice';
import { clearPageEdit, peekPageEdit } from '../lib/share/editShared';

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
  const { t, locale } = useLanguage();
  useItemNames();
  const { simcInput, hasInput, unsimmableSpec } = useSimContext();
  const [compute, setCompute] = useComputeChoice('upgrade_compare');

  const { data, loading } = useUpgradeData(simcInput);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const currencies = useMemo(() => data?.currencies ?? {}, [data]);
  const hasCurrencies = Object.keys(currencies).length > 0;

  // Reset selection when candidates change; a shared sim being edited picks its slots.
  useEffect(() => {
    const shared = data ? peekPageEdit(['upgrade_compare'])?.selected_slots : undefined;
    if (!Array.isArray(shared)) {
      setSelectedSlots(new Set());
      return;
    }
    clearPageEdit();
    const offered = new Set(data?.candidates.map((c) => c.slot));
    setSelectedSlots(new Set(shared.filter((s): s is string => offered.has(s))));
  }, [data]);

  // Item info for display
  const infoQueries = useMemo<ItemQuery[]>(
    () => candidates.map((c) => ({ item_id: c.item_id, bonus_ids: c.bonus_ids })),
    [candidates]
  );
  const itemInfo = useItemInfo(infoQueries);
  useWowheadTooltips([itemInfo]);

  const { comboCount } = useComboCount(
    '/api/upgrade-compare/combo-count',
    () => ({ simc_input: simcInput, selected_slots: [...selectedSlots] }),
    [simcInput, selectedSlots],
    { enabled: selectedSlots.size > 0 && !!simcInput.trim() }
  );

  // Sim submission
  const buildPayload = useCallback(() => {
    if (selectedSlots.size === 0) return null;
    return {
      simc_input: simcInput,
      selected_slots: [...selectedSlots],
      compute_provider: compute,
    };
  }, [simcInput, selectedSlots, compute]);

  const validate = useCallback(() => {
    if (!hasInput) return t('validation.simcTooShort');
    if (unsimmableSpec) return t('validation.unsupportedSpec', { spec: unsimmableSpec.label });
    if (selectedSlots.size === 0) return t('upgradeCompare.selectUpgradeable');
    return null;
  }, [hasInput, selectedSlots, unsimmableSpec, t]);

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

  const hasCharacter = hasInput;

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
      <p className="py-6 text-center text-sm text-outline">{t('upgradeCompare.pasteExport')}</p>
    );
  }

  const submitLabel = !hasCurrencies
    ? t('upgradeCompare.noCurrencies')
    : selectedSlots.size === 0
      ? t('upgradeCompare.selectItemsButton')
      : buttonLabel(t('button.simUpgrades', { count: comboCount }));

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('nav.crestUpgrades')}
        subtitle={t('page.crestUpgradesSubtitle')}
      />
      <SimSettingsBlock />
      <TalentPicker />
      {/* Explainer */}
      <div className="card px-6 py-4">
        <p className="text-[15px] leading-relaxed text-on-surface-variant">
          {t('upgradeCompare.explainer')}
        </p>
      </div>

      {/* Currency Budget */}
      {hasCurrencies && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="lbl">{t('upgradeCompare.budget')}</span>
          {Object.values(currencies)
            .filter((c) => c.name)
            .sort((a, b) => a.id - b.id)
            .map((c) => (
              <Pill key={c.id}>
                <img {...iconProps(c.icon)} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                {c.name}
                <span className="tabular-nums text-on-surface">{c.amount}</span>
              </Pill>
            ))}
        </div>
      )}

      {/* Upgradeable Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="lbl">{t('upgradeCompare.selectItems')}</p>
          {comboCount > 0 && (
            <Pill>{t('upgradeCompare.combosCount', { count: comboCount.toLocaleString() })}</Pill>
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
            <p className="text-sm text-outline">{t('upgradeCompare.noUpgradeable')}</p>
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
                        {...iconProps(group.currency?.icon)}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-sm"
                      />
                      <p className="lbl">
                        {group.currency?.name ||
                          t('upgradeCompare.unknownCurrency', { id: group.currencyId })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.candidates)}
                      className="text-[12px] text-on-surface-variant/60 hover:text-on-surface-variant"
                    >
                      {allSelected ? t('common.deselect') : t('common.selectAll')}
                    </button>
                  </div>

                  {group.candidates.map((c) => {
                    const info = itemInfo[c.item_id];
                    const qc = info
                      ? QUALITY_COLORS[info.quality] || QUALITY_COLORS[1]
                      : QUALITY_COLORS[1];

                    return (
                      <GearItemRow
                        key={c.slot}
                        icon={info?.icon || 'inv_misc_questionmark'}
                        name={localizedItemName(
                          c.item_id,
                          info?.name || `Item ${c.item_id}`,
                          locale
                        )}
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
                        href={c.item_id > 0 ? getWowheadUrl(c.item_id, locale) : undefined}
                        wowheadData={
                          c.item_id > 0
                            ? `bonus=${c.bonus_ids.join(':')}&ilvl=${c.ilevel}`
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SimcDownloadBanner />
      <ErrorAlert message={error} />

      <ConfigFooter
        onSubmit={handleSubmit}
        submitting={submitting}
        buttonLabel={submitLabel}
        disabled={selectedSlots.size === 0 || !hasCurrencies}
        compute={compute}
        onComputeChange={setCompute}
      />
    </div>
  );
}
