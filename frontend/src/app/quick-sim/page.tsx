'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import PageHeader from '../components/ui/PageHeader';
import Pill from '../components/ui/Pill';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import GearOverview from '../components/gear/GearOverview';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import SimSettingsBlock from '../components/sim-config/SimSettingsBlock';
import { specDisplayName } from '../lib/types';
import { API_URL } from '../lib/api';
import { useResolvedGear, equippedGearItems } from '../lib/useResolvedGear';
import { useLanguage } from '../lib/i18n';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../lib/useItemInfo';
import { parseCharacterInfo } from '../lib/character';
import { useRealmSlug } from '../lib/realms';
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
  const { simcInput, hasInput, statWeights, unsimmableSpec } = useSimContext();
  const { t } = useLanguage();
  const [compute, setCompute] = useComputeChoice('quick');

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const lastSim = useLastSim(characterInfo?.name ?? null, characterInfo?.realm ?? null);
  const { resolved } = useResolvedGear(simcInput);
  const equippedGear = useMemo(() => equippedGearItems(resolved), [resolved]);

  const goItemQueries = useMemo(() => collectItemQueries(equippedGear ?? {}), [equippedGear]);
  const goEnchantIds = useMemo(() => collectEnchantIds(equippedGear ?? {}), [equippedGear]);
  const goGemIds = useMemo(() => collectGemIds(equippedGear ?? {}), [equippedGear]);
  const goItemInfo = useItemInfo(goItemQueries);
  const goEnchantInfo = useEnchantInfo(goEnchantIds);
  const goGemInfo = useGemInfo(goGemIds);

  const realmSlug = useRealmSlug(characterInfo?.realm);
  // The face icon reads best at thumbnail size.
  const avatarUrl =
    realmSlug && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${characterInfo.region}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/avatar`
      : null;

  const renderUrl =
    realmSlug && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${characterInfo.region}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/render`
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
    if (unsimmableSpec) return t('validation.unsupportedSpec', { spec: unsimmableSpec.label });
    return null;
  }, [hasInput, unsimmableSpec, t]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('nav.quickSim')}
        subtitle={t('page.quickSimSubtitle')}
      />

      {/* Character summary card */}
      {characterInfo && (
        <div className="card flex items-center gap-[18px] px-6 py-5">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-[10px] border border-line/[0.11] object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-headline text-xl font-extrabold leading-[1.1] tracking-[-0.01em] text-on-surface">
              {characterInfo.name}
            </h2>
            <div className="mt-[7px] flex items-center gap-2">
              <Pill variant="gold">
                {specDisplayName(characterInfo.spec)} {characterInfo.className.replace(/_/g, ' ')}
              </Pill>
              {characterInfo.realm && (
                <span className="text-[12.5px] text-outline">{characterInfo.realm}</span>
              )}
            </div>
          </div>

          {/* Last sim result */}
          {lastSim && lastSim.dps && (
            <a
              href={`/sim/${lastSim.id}`}
              className="text-right transition-opacity hover:opacity-80"
            >
              <div className="lbl">{t('quickSim.lastSim')}</div>
              <div className="mt-1.5 font-headline text-2xl font-extrabold tabular-nums text-gold">
                {Math.round(lastSim.dps).toLocaleString()}{' '}
                <span className="text-xs text-gold-dark">DPS</span>
              </div>
              <div className="mt-0.5 text-xs text-outline">{lastSim.fight_style}</div>
            </a>
          )}
        </div>
      )}

      <SimSettingsBlock />
      <TalentPicker hideCompare />
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
