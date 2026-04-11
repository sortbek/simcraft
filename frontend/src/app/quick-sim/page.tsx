'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import { useSimContext } from '../components/sim-config/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import TalentPicker from '../components/talents/TalentPicker';
import GearOverview from '../components/gear/GearOverview';
import type { GearItem } from '../components/gear/GearOverview';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import { specDisplayName } from '../lib/types';
import { API_URL } from '../lib/api';
import type { ResolveGearResponse } from '../lib/types';
import { useLanguage } from '../lib/i18n';

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  const realmMatch = input.match(/^server=(.+)$/m);
  if (!nameMatch) return null;
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
    realm: realmMatch?.[1] || null,
  };
}

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
      `${API_URL}/api/sims?player=${encodeURIComponent(name)}&realm=${encodeURIComponent(realm)}`
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

function useEquippedGear(simcInput: string): Record<string, GearItem> | null {
  const [gear, setGear] = useState<Record<string, GearItem> | null>(null);

  useEffect(() => {
    if (simcInput.trim().length < 10) {
      setGear(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/gear/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simc_input: simcInput, max_upgrade: false, catalyst: false }),
        });
        if (!res.ok) return;
        const data: ResolveGearResponse = await res.json();
        const gearMap: Record<string, GearItem> = {};
        for (const [slot, resolution] of Object.entries(data.slots)) {
          if (resolution.equipped) {
            const eq = resolution.equipped;
            gearMap[slot] = {
              slot: eq.slot,
              item_id: eq.item_id,
              ilevel: eq.ilevel,
              name: eq.name,
              bonus_ids: eq.bonus_ids,
              enchant_id: eq.enchant_id || undefined,
              gem_id: eq.gem_id || undefined,
            };
          }
        }
        if (Object.keys(gearMap).length > 0) setGear(gearMap);
        else setGear(null);
      } catch {
        setGear(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [simcInput]);

  return gear;
}

export default function QuickSimPage() {
  const { simcInput, hasInput } = useSimContext();
  const { t } = useLanguage();

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const lastSim = useLastSim(characterInfo?.name ?? null, characterInfo?.realm ?? null);
  const equippedGear = useEquippedGear(simcInput);

  const insetUrl =
    characterInfo?.realm && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(characterInfo.realm.toLowerCase())}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/inset`
      : null;

  const renderUrl =
    characterInfo?.realm && characterInfo?.name
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(characterInfo.realm.toLowerCase())}/${encodeURIComponent(characterInfo.name.toLowerCase())}/media/render`
      : null;

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: 'quick',
    }),
    [simcInput]
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
        <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-on-surface mb-2">
          Quick Sim
        </h1>
        <p className="text-sm text-on-surface-variant max-w-2xl">
          Run a quick simulation to check your DPS and stat weights with your current gear and talents.
        </p>
      </div>


      {/* Character summary card */}
      {characterInfo && (
        <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 flex items-center justify-between">
          <div className="flex items-center gap-5">
            {insetUrl && (
              <img
                src={insetUrl}
                alt=""
                className="w-16 h-16 rounded-full border-2 border-outline-variant/30 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div>
              <h2 className="font-headline font-extrabold text-2xl tracking-tight text-on-surface">
                {characterInfo.name}
              </h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="bg-primary-container/20 text-primary px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">
                  {specDisplayName(characterInfo.spec)} {characterInfo.className.replace(/_/g, ' ')}
                </span>
                {characterInfo.realm && (
                  <span className="text-on-surface-variant text-sm border-l border-outline-variant/30 pl-3">
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
              <div className="text-[10px] uppercase text-on-surface-variant/50 mb-1">{t('quickSim.lastSim')}</div>
              <div className="font-headline font-black text-2xl text-primary tabular-nums">
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
        />
      )}

      <ErrorAlert message={error} />
      <ConfigFooter
        onSubmit={submit}
        submitting={submitting}
        buttonLabel={buttonLabel(t('button.runSimulation'))}
        disabled={!hasInput}
      />
    </div>
  );
}
