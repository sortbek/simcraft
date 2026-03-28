import { useEffect, useState } from 'react';
import { API_URL } from '../lib/api';

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
  /** Optional content rendered between the DPS number and the metadata bar */
  children?: React.ReactNode;
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
  children,
}: DpsHeroCardProps) {
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

  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden px-8 pb-6 pt-8 text-center">
        {faction && (faction === 'horde' || faction === 'alliance') && (
          <div
            className={`pointer-events-none absolute inset-0 ${
              faction === 'horde' ? 'bg-red-950/30' : 'bg-blue-950/30'
            }`}
            style={{
              maskImage: 'linear-gradient(to left, black 20%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to left, black 20%, transparent 60%)',
            }}
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
        {insetUrl && (
          <img
            src={insetUrl}
            alt=""
            className="pointer-events-none absolute bottom-0 left-0 h-[130%] w-auto -translate-x-1/4 object-contain opacity-15"
            style={{
              maskImage: 'linear-gradient(to right, black 50%, transparent 95%)',
              WebkitMaskImage: 'linear-gradient(to right, black 50%, transparent 95%)',
            }}
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
        <div className="relative">
          <p className="text-2xl font-bold tracking-tight text-white">{playerName}</p>
          <p className="mt-0.5 text-sm font-medium text-gold/70">{playerClass}</p>
          <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight text-white">
            {Math.round(dps).toLocaleString()}
          </p>
          <p className="mt-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Damage Per Second
          </p>
          {children}
        </div>
      </div>
      {hasMetadata && (
        <div className="flex items-center justify-center gap-px border-t border-border bg-surface-2">
          {dpsError != null && dpsError > 0 && (
            <MetaStat
              label="Margin of Error"
              value={`± ${Math.round(dpsError).toLocaleString()}`}
              note={dpsErrorPct != null ? `${dpsErrorPct}%` : undefined}
            />
          )}
          {fightLength != null && (
            <MetaStat label="Fight Length" value={formatDuration(fightLength)} />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <MetaStat
              label="Targets"
              value={desiredTargets === 1 ? '1 Boss' : `${desiredTargets} Bosses`}
            />
          )}
          {iterations != null && iterations > 0 && (
            <MetaStat
              label="Iterations"
              value={iterations.toLocaleString()}
              note={targetError != null && targetError > 0 ? 'Smart Sim' : undefined}
            />
          )}
          {elapsedTime != null && <MetaStat label="Time" value={formatElapsed(elapsedTime)} />}
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex-1 px-4 py-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums text-zinc-300">
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-zinc-600">{note}</span>}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

function formatElapsed(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.floor(seconds / 60);
    const sec = String(Math.round(seconds % 60)).padStart(2, '0');
    return `${min}:${sec}`;
  }
  return `${seconds.toFixed(1)}s`;
}
