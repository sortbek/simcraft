/* eslint-disable @next/next/no-img-element */

import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import HeroMetaStat from './HeroMetaStat';
import {
  FACTION_BGS,
  FACTION_ICONS,
  formatDuration,
  formatElapsed,
  getCharacterMediaUrl,
  useFaction,
} from './dpsHeroUtils';

interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  dps: number;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  baseDps?: number;
  children?: React.ReactNode;
  topAction?: React.ReactNode;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
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

  const faction = useFaction(playerRealm, playerName, playerRegion);
  const insetUrl = getCharacterMediaUrl(playerRealm, playerName, 'inset', playerRegion);
  const renderUrl = getCharacterMediaUrl(playerRealm, playerName, 'render', playerRegion);

  return (
    <section className="relative overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low shadow-2xl">
      <div className="absolute inset-0 z-0">
        {insetUrl && (
          <img
            src={insetUrl}
            alt=""
            className="h-full w-full object-cover opacity-30 grayscale"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
      </div>

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
      {topAction && <div className="absolute right-4 top-4 z-20">{topAction}</div>}

      <div className="relative z-10 flex flex-col items-center gap-12 p-8 md:flex-row">
        <div className="flex-1 text-center md:text-left">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
              {playerName}
              {playerRealm ? `-${playerRealm}` : ''}
            </h1>
          </div>
          <p className="mb-6 font-headline text-sm uppercase tracking-widest text-on-surface-variant">
            {playerClass}
          </p>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2 font-headline text-7xl font-black tabular-nums tracking-tighter text-primary md:text-8xl">
              {Math.round(dps).toLocaleString()}
              <span className="text-2xl font-bold opacity-50">{t('results.dps')}</span>
            </div>
            {dpsDelta != null && dpsDeltaPct != null && (
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className={`font-bold ${dpsDelta >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                  {dpsDelta >= 0 ? '+' : ''}
                  {dpsDeltaPct.toFixed(1)}%
                </span>
                <span className="opacity-50">{t('results.vsPreviousSim')}</span>
              </div>
            )}
          </div>
          {children}
        </div>
      </div>

      {hasMetadata && (
        <div className="relative z-10 grid grid-cols-2 gap-4 border-t border-outline-variant/10 bg-surface-container-lowest/80 px-8 py-4 backdrop-blur-md md:grid-cols-5">
          {dpsError != null && dpsError > 0 && (
            <HeroMetaStat
              label={t('results.error')}
              value={`Â± ${Math.round(dpsError).toLocaleString()}${
                dpsErrorPct != null ? ` (${dpsErrorPct}%)` : ''
              }`}
              note={targetError != null && targetError > 0 ? `target: ${targetError}%` : undefined}
            />
          )}
          {fightLength != null && (
            <HeroMetaStat
              label={t('results.fightLength')}
              value={formatDuration(fightLength)}
              border
            />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <HeroMetaStat
              label={t('results.targets')}
              value={
                desiredTargets === 1 ? '1 (Patchwerk)' : `${desiredTargets} ${t('results.targets')}`
              }
              border
            />
          )}
          {iterations != null && iterations > 0 && (
            <HeroMetaStat
              label={t('results.iterations')}
              value={iterations.toLocaleString()}
              border
            />
          )}
          {elapsedTime != null && (
            <HeroMetaStat label={t('results.elapsed')} value={formatElapsed(elapsedTime)} border />
          )}
        </div>
      )}
    </section>
  );
}
