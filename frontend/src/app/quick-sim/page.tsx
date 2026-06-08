'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import GearOverview from '../components/gear/GearOverview';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { specDisplayName } from '../lib/types';
import { API_URL } from '../lib/api';
import { useResolvedGear, equippedGearItems } from '../lib/useResolvedGear';
import { useLanguage } from '../lib/i18n';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../lib/useItemInfo';
import { parseCharacterInfo } from '../lib/character';
import { useComputeChoice } from '../lib/useComputeChoice';
import {
  collectEnchantIds,
  collectGemIds,
  collectItemQueries,
} from '../components/gear/gearOverviewUtils';

interface LastSim {
  id: string;
  dps: number | null;
  fight_style: string;
  sim_type: string;
  created_at: string;
  status: string;
}

function useLastSim(name: string | null, realm: string | null): LastSim | null {
  const [lastSim, setLastSim] = useState<LastSim | null>(null);

  useEffect(() => {
    if (!name || !realm) {
      setLastSim(null);
      return;
    }
    fetch(
      `${API_URL}/api/jobs?status=all&player=${encodeURIComponent(name)}&realm=${encodeURIComponent(realm)}&limit=10`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((sims: LastSim[]) => {
        const done = sims.find((s) => s.status === 'done' && s.dps);
        setLastSim(done || null);
      })
      .catch(() => setLastSim(null));
  }, [name, realm]);

  return lastSim;
}

export default function QuickSimPage() {
  const { simcInput, hasInput, statWeights } = useSimContext();
  const { t } = useLanguage();
  const [compute, setCompute] = useComputeChoice('quick');

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const lastSim = useLastSim(characterInfo?.name ?? null, characterInfo?.realm ?? null);
  const { resolved } = useResolvedGear(simcInput);
  const equippedGear = useMemo(() => equippedGearItems(resolved), [resolved]);

  const goItemQueries = useMemo(
    () => collectItemQueries(equippedGear ?? {}),
    [equippedGear]
  );
  const goEnchantIds = useMemo(() => collectEnchantIds(equippedGear ?? {}), [equippedGear]);
  const goGemIds = useMemo(() => collectGemIds(equippedGear ?? {}), [equippedGear]);
  const goItemInfo = useItemInfo(goItemQueries);
  const goEnchantInfo = useEnchantInfo(goEnchantIds);
  const goGemInfo = useGemInfo(goGemIds);

  const insetUrl =
    characterInfo?.realm && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${characterInfo.region}/${encodeURIComponent(characterInfo.realm.toLowerCase())}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/inset`
      : null;

  const renderUrl =
    characterInfo?.realm && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${characterInfo.region}/${encodeURIComponent(characterInfo.realm.toLowerCase())}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/render`
      : null;

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: statWeights ? 'stat_weights' : 'quick',
      compute_provider: compute,
    }),
    [simcInput, statWeights, compute]
  );

  const validate = useCallback(() => {
    if (!hasInput) return t('validation.simcTooShort');
    return null;
  }, [hasInput, t]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          Quick Sim
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">
          Run a quick simulation to check your DPS and stat weights with your current gear and
          talents.
        </p>
      </div>

      {/* Character summary card */}
      {characterInfo && (
        <div className="flex items-center justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low p-6">
          <div className="flex items-center gap-5">
            {insetUrl && (
              <img
                src={insetUrl}
                alt=""
                className="h-16 w-16 rounded-full border-2 border-outline-variant/30 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div>
              <h2 className="font-headline text-2xl font-extrabold tracking-tight text-on-surface">
                {characterInfo.name}
              </h2>
              <div className="mt-1 flex items-center gap-3">
                <span className="rounded bg-primary-container/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                  {specDisplayName(characterInfo.spec)} {characterInfo.className.replace(/_/g, ' ')}
                </span>
                {characterInfo.realm && (
                  <span className="border-l border-outline-variant/30 pl-3 text-sm text-on-surface-variant">
                    {characterInfo.realm}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Last sim result */}
          {lastSim && lastSim.dps && (
            <a
              href={`/sim/${lastSim.id}`}
              className="text-right transition-colors hover:opacity-80"
            >
              <div className="mb-1 text-[10px] uppercase text-on-surface-variant/50">
                {t('quickSim.lastSim')}
              </div>
              <div className="font-headline text-2xl font-black tabular-nums text-primary">
                {Math.round(lastSim.dps).toLocaleString()}
              </div>
              <div className="text-[10px] text-on-surface-variant/40">
                {lastSim.fight_style} &middot; DPS
              </div>
            </a>
          )}
        </div>
      )}

      <TalentPicker defaultView="view" hideCompare />
      {equippedGear && (
        <GearOverview
          gear={equippedGear}
          title={t('gear.equippedGear')}
          characterRenderUrl={renderUrl}
          itemInfoMap={goItemInfo}
          enchantInfoMap={goEnchantInfo}
          gemInfoMap={goGemInfo}
        />
      )}

      <SimcDownloadBanner />
      <ErrorAlert message={error} />
      <ConfigFooter
        onSubmit={submit}
        submitting={submitting}
        buttonLabel={buttonLabel(t('button.runSimulation'))}
        disabled={!hasInput}
        showStatWeightsToggle
        compute={compute}
        onComputeChange={setCompute}
      />
    </div>
  );
}
