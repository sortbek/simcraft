/* eslint-disable @next/next/no-img-element */

import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import Pill from '../ui/Pill';
import HeroMetaStat from './HeroMetaStat';
import {
  FACTION_BGS,
  FACTION_ICONS,
  formatDuration,
  formatElapsed,
  getCharacterMediaUrl,
  useFaction,
} from './dpsHeroUtils';

// Mock `.hero .bg`: base gradient plus a gold glow top-left and a faction tint top-right.
const HERO_BASE =
  'linear-gradient(180deg,rgb(var(--c-surface-container-high)),rgb(var(--c-surface-container)))';
const FACTION_TINT: Record<string, string> = {
  horde: 'rgb(140 32 24 / var(--hero-tint-a))',
  alliance: 'rgb(24 56 140 / var(--hero-tint-a))',
};

function heroGlow(faction: string | null): string {
  const gold =
    'radial-gradient(ellipse 40% 60% at 15% 0%,rgb(var(--c-primary-fill) / .07),transparent 70%)';
  const tint = faction ? FACTION_TINT[faction] : undefined;
  return tint
    ? `radial-gradient(ellipse 55% 90% at 82% 30%,${tint},transparent 70%),${gold}`
    : gold;
}

interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  dps: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  baseDps?: number;
  children?: React.ReactNode;
  topAction?: React.ReactNode;
  /** Sits in the empty space right of the DPS number (below it on narrow screens). */
  aside?: React.ReactNode;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  dps,
  fightLength,
  iterations,
  targetError,
  desiredTargets,
  elapsedTime,
  baseDps,
  children,
  topAction,
  aside,
}: DpsHeroCardProps) {
  const { t } = useLanguage();
  const dpsDelta = baseDps != null && baseDps > 0 ? dps - baseDps : null;
  const dpsDeltaPct = baseDps != null && baseDps > 0 ? ((dps - baseDps) / baseDps) * 100 : null;

  const hasMetadata =
    (targetError != null && targetError > 0) ||
    fightLength != null ||
    (iterations != null && iterations > 0) ||
    elapsedTime != null;

  const faction = useFaction(playerRealm, playerName, playerRegion);
  const insetUrl = getCharacterMediaUrl(playerRealm, playerName, 'inset', playerRegion);
  const renderUrl = getCharacterMediaUrl(playerRealm, playerName, 'render', playerRegion);

  return (
    <section
      className="relative overflow-hidden rounded-[10px] border border-line/[0.06] [box-shadow:var(--shadow-card)]"
      style={{ background: HERO_BASE }}
    >
      <div className="absolute inset-0 z-0">
        {insetUrl && (
          <img
            src={insetUrl}
            alt=""
            className="h-full w-full object-cover opacity-[var(--hero-art-o)] grayscale"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-surface-container via-surface-container/80 to-transparent" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: heroGlow(faction) }}
      />
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
      {topAction && <div className="absolute right-6 top-6 z-20 flex gap-2">{topAction}</div>}

      <div className="relative z-10 px-9 pb-[30px] pt-[34px]">
        <h1 className="font-headline text-[34px] font-extrabold uppercase leading-none tracking-[-0.01em] text-on-surface">
          {playerName}
          {playerRealm ? `-${playerRealm}` : ''}
        </h1>
        <p className="mt-2.5 font-headline text-[13px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
          {playerClass}
        </p>
        <div className="mt-[26px] flex items-baseline gap-2.5">
          <span className="font-headline text-[92px] font-extrabold tabular-nums leading-[0.9] tracking-[-0.03em] text-gold [text-shadow:0_0_60px_rgb(var(--c-primary)/var(--hero-glow-a))]">
            {Math.round(dps).toLocaleString()}
          </span>
          <span className="font-headline text-xl font-extrabold tracking-[0.04em] text-gold-dark">
            {t('results.dps')}
          </span>
        </div>
        {dpsDelta != null && dpsDeltaPct != null && (
          <div className="mt-3.5">
            <Pill variant={dpsDelta >= 0 ? 'positive' : 'negative'}>
              {dpsDelta >= 0 ? '▲' : '▼'} {Math.abs(dpsDeltaPct).toFixed(1)}%{' '}
              {t('results.vsPreviousSim')}
            </Pill>
          </div>
        )}
        {children}
        {aside && (
          <div className="mt-6 lg:absolute lg:bottom-[30px] lg:right-9 lg:mt-0">{aside}</div>
        )}
      </div>

      {hasMetadata && (
        <div className="relative z-10 grid grid-cols-2 border-t border-line/[0.06] bg-[color:var(--hero-meta-bg)] md:grid-cols-5 [&>*+*]:shadow-[inset_1px_0_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]">
          {targetError != null && targetError > 0 && (
            <HeroMetaStat
              label={t('results.error')}
              value={`± ${targetError}%`}
              note={`± ${Math.round((targetError / 100) * dps).toLocaleString()} ${t('results.dps')}`}
            />
          )}
          {fightLength != null && (
            <HeroMetaStat label={t('results.fightLength')} value={formatDuration(fightLength)} />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <HeroMetaStat
              label={t('results.targets')}
              value={
                desiredTargets === 1 ? '1 (Patchwerk)' : `${desiredTargets} ${t('results.targets')}`
              }
            />
          )}
          {iterations != null && iterations > 0 && (
            <HeroMetaStat label={t('results.iterations')} value={iterations.toLocaleString()} />
          )}
          {elapsedTime != null && (
            <HeroMetaStat label={t('results.elapsed')} value={formatElapsed(elapsedTime)} />
          )}
        </div>
      )}
    </section>
  );
}
