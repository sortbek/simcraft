import { useEffect, useState } from 'react';
import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';

interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  dps: number;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  /** Baseline DPS to show delta (e.g. base_dps from top gear results) */
  baseDps?: number;
  /** Optional content rendered between the DPS number and the metadata bar */
  children?: React.ReactNode;
  /** Optional action rendered in the top-right corner of the hero card */
  topAction?: React.ReactNode;
}

const FACTION_ICONS: Record<string, string> = {
  alliance: '/api/data/static/faction-alliance.png',
  horde: '/api/data/static/faction-horde.png',
};

const FACTION_BGS: Record<string, string> = {
  alliance: '/api/data/static/faction-bg-alliance.jpg',
  horde: '/api/data/static/faction-bg-horde.jpg',
};

function useFaction(realm?: string, name?: string): string | null {
  const [faction, setFaction] = useState<string | null>(null);

  useEffect(() => {
    if (!realm || !name) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://simhammer.com/api/blizzard/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/profile`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.faction) setFaction(data.faction);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [realm, name]);

  return faction;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  playerRealm,
  dps,
  dpsError,
  dpsErrorPct,
  fightLength,
  iterations,
  targetError,
  desiredTargets,
  elapsedTime,
  baseDps,
  children,
  topAction,
}: DpsHeroCardProps) {
  const { t } = useLanguage();
  const dpsDelta = baseDps != null && baseDps > 0 ? dps - baseDps : null;
  const dpsDeltaPct = baseDps != null && baseDps > 0 ? ((dps - baseDps) / baseDps) * 100 : null;

  const hasMetadata =
    (dpsError != null && dpsError > 0) ||
    fightLength != null ||
    (iterations != null && iterations > 0) ||
    elapsedTime != null;

  const faction = useFaction(playerRealm, playerName);

  const insetUrl =
    playerRealm && playerName
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(playerRealm.toLowerCase())}/${encodeURIComponent(playerName.toLowerCase())}/media/inset`
      : null;

  const renderUrl =
    playerRealm && playerName
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(playerRealm.toLowerCase())}/${encodeURIComponent(playerName.toLowerCase())}/media/render`
      : null;

  return (
    <section className="relative overflow-hidden rounded-xl bg-surface-container-low shadow-2xl border border-outline-variant/10">
      {/* Background character render */}
      <div className="absolute inset-0 z-0">
        {insetUrl && (
          <img
            src={insetUrl}
            alt=""
            className="w-full h-full object-cover opacity-30 grayscale"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
      </div>
      {/* Faction gradient overlay */}
      {faction && (faction === 'horde' || faction === 'alliance') && (
        <div
          className={`pointer-events-none absolute inset-0 z-0 ${
            faction === 'horde'
              ? 'bg-gradient-to-br from-red-950/50 to-transparent'
              : 'bg-gradient-to-br from-blue-950/50 to-transparent'
          }`}
          style={{ opacity: 0.4 }}
        />
      )}
      {faction && FACTION_BGS[faction] && (
        <img
          src={`${API_URL}${FACTION_BGS[faction]}`}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.06]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {faction && FACTION_ICONS[faction] && (
        <img
          src={`${API_URL}${FACTION_ICONS[faction]}`}
          alt=""
          className="pointer-events-none absolute bottom-0 right-[5%] top-[0%] h-[100%] w-auto object-contain opacity-[0.08]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {/* Top-right action */}
      {topAction && (
        <div className="absolute top-4 right-4 z-20">
          {topAction}
        </div>
      )}
      {/* Hero content */}
      <div className="relative z-10 p-8 flex flex-col md:flex-row items-center gap-12">
        <div className="text-center md:text-left flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-headline font-black text-4xl tracking-tighter text-on-surface uppercase">
              {playerName}{playerRealm ? `-${playerRealm}` : ''}
            </h1>
          </div>
          <p className="font-headline text-on-surface-variant tracking-widest text-sm uppercase mb-6">
            {playerClass}
          </p>
          <div className="space-y-1">
            <div className="text-primary font-headline font-black text-7xl md:text-8xl tracking-tighter flex items-baseline gap-2 tabular-nums">
              {Math.round(dps).toLocaleString()} <span className="text-2xl font-bold opacity-50">{t('results.dps')}</span>
            </div>
            {dpsDelta != null && dpsDeltaPct != null && (
              <div className="text-on-surface-variant text-xs flex items-center gap-2">
                <span className={`font-bold ${dpsDelta >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                  {dpsDelta >= 0 ? '+' : ''}{dpsDeltaPct.toFixed(1)}%
                </span>
                <span className="opacity-50">{t('results.vsPreviousSim')}</span>
              </div>
            )}
          </div>
          {children}
        </div>
      </div>
      {/* Metadata strip */}
      {hasMetadata && (
        <div className="relative z-10 bg-surface-container-lowest/80 backdrop-blur-md border-t border-outline-variant/10 grid grid-cols-2 md:grid-cols-5 px-8 py-4 gap-4">
          {dpsError != null && dpsError > 0 && (
            <MetaStat
              label={t('results.error')}
              value={`± ${Math.round(dpsError).toLocaleString()}${dpsErrorPct != null ? ` (${dpsErrorPct}%)` : ''}`}
              note={targetError != null && targetError > 0 ? `target: ${targetError}%` : undefined}
            />
          )}
          {fightLength != null && (
            <MetaStat label={t('results.fightLength')} value={formatDuration(fightLength)} border />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <MetaStat
              label={t('results.targets')}
              value={desiredTargets === 1 ? '1 (Patchwerk)' : `${desiredTargets} ${t('results.targets')}`}
              border
            />
          )}
          {iterations != null && iterations > 0 && (
            <MetaStat
              label={t('results.iterations')}
              value={iterations.toLocaleString()}
              border
            />
          )}
          {elapsedTime != null && <MetaStat label={t('results.elapsed')} value={formatElapsed(elapsedTime)} border />}
        </div>
      )}
    </section>
  );
}

function MetaStat({
  label,
  value,
  note,
  border,
}: {
  label: string;
  value: string;
  note?: string;
  border?: boolean;
}) {
  return (
    <div className={`flex flex-col${border ? ' border-l border-outline-variant/10 pl-4' : ''}`}>
      <span className="text-[10px] font-headline font-bold uppercase text-on-surface-variant opacity-60">
        {label}
      </span>
      <span className="font-headline font-bold text-sm text-on-surface">
        {value}
        {note && (
          <span className="ml-1 text-[10px] font-normal text-on-surface-variant/40">{note}</span>
        )}
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function formatElapsed(seconds: number): string {
  if (seconds >= 60) {
    const total = Math.round(seconds);
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return `${min}:${sec}`;
  }
  return `${seconds.toFixed(1)}s`;
}
