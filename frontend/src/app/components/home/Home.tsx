'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import { useLanguage } from '../../lib/i18n';
import { parseCharacterInfo } from '../../lib/character';
import { useRealmSlug } from '../../lib/realms';
import { ROUTES, SIM_RESULT_PREFIX } from '../../lib/routes';
import { CLASS_COLORS } from '../../lib/types';
import { getSimTypeLabel } from '../../lib/simTypes';
import { useActiveSims, isActiveStatus } from '../../lib/useActiveSims';
import { equippedGearItems, useResolvedGear } from '../../lib/useResolvedGear';
import { averageItemLevel } from '../gear/GearOverview';
import { getCharacterAvatarUrl, getCharacterRenderUrl } from '../gear/topGearResultsUtils';
import { timeAgo } from '../../sims/_components/shared';
import CharacterImport from '../layout/CharacterImport';
import CardHeader from '../ui/CardHeader';
import HomeHero from './HomeHero';
import { HomeIcon, type HomeIconName } from './HomeIcons';
import { lastDoneBySimType, quickSimTrend, recentJobs } from './homeModel';
import { useCharacterJobs, useRecentJobs, useSeasonRotation, zoneBackground } from './useHomeData';
import { useIsDesktop } from '../../lib/useIsDesktop';

const TOOLS: { simType: string; route: string; question: string; icon: HomeIconName }[] = [
  { simType: 'quick', route: ROUTES.quickSim, question: 'home.qQuick', icon: 'quick' },
  { simType: 'top_gear', route: ROUTES.topGear, question: 'home.qTopGear', icon: 'top' },
  { simType: 'droptimizer', route: ROUTES.dropFinder, question: 'home.qDrop', icon: 'drop' },
  {
    simType: 'upgrade_compare',
    route: ROUTES.upgradeCompare,
    question: 'home.qCrest',
    icon: 'crest',
  },
];

// Longest names first, so "Demon Hunter" isn't read as "Hunter".
const CLASS_NAMES = Object.keys(CLASS_COLORS).sort((a, b) => b.length - a.length);

/** Class colour from a job's "Unholy Death Knight"-style label. */
function classColorOf(label: string | null): string | undefined {
  const lower = label?.toLowerCase() ?? '';
  const key = CLASS_NAMES.find((k) => lower.endsWith(k.replace(/_/g, ' ')));
  return key && CLASS_COLORS[key];
}

/** `grim_batol` → `Grim Batol`, for the class, race and realm in the SimC export. */
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const CARD =
  'rounded-[12px] border border-line/[0.06] bg-surface-container [box-shadow:var(--shadow-card)]';

function QuestionCards({ lastRun }: { lastRun?: Record<string, string> }) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {TOOLS.map((tool) => (
        <Link
          key={tool.simType}
          href={tool.route}
          className={`${CARD} group flex flex-col p-[18px] transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-gold/35`}
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-gold-tint text-gold">
            <HomeIcon name={tool.icon} />
          </span>
          <span className="mt-3 font-headline text-base font-bold leading-snug text-on-surface">
            {t(tool.question)}
          </span>
          <span className="mt-1.5 text-xs text-outline">{getSimTypeLabel(tool.simType, t)}</span>
          {lastRun && (
            <span className="mt-3.5 flex items-center justify-between border-t border-line/[0.06] pt-3 text-xs text-on-surface-variant">
              {lastRun[tool.simType] ?? t('home.notRunYet')}
              <HomeIcon
                name="arrow"
                className="h-4 w-4 text-outline transition-colors group-hover:text-gold"
              />
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

function Welcome({ backdrop }: { backdrop: string | null }) {
  const { t } = useLanguage();
  const { setSimcInput } = useSimContext();
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[16px] border border-line/[0.06] bg-surface-container-lowest px-12 py-14">
        {backdrop && (
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25 after:absolute after:inset-0 after:bg-[linear-gradient(90deg,rgb(var(--c-background)/.97)_35%,rgb(var(--c-background)/.5))] after:content-['']"
            style={{ backgroundImage: backdrop }}
          />
        )}
        <div className="relative max-w-[620px]">
          <span className="lbl !text-gold">{t('home.welcomeEyebrow')}</span>
          <h1 className="mb-3 mt-3.5 font-headline text-[40px] font-extrabold leading-[1.05] tracking-[-0.01em] text-on-surface">
            {t('home.welcomeTitle')}
          </h1>
          <p className="mb-6 text-[15px] leading-relaxed text-on-surface-variant">
            {t('home.welcomeBody')}
          </p>
          <CharacterImport
            onApply={setSimcInput}
            applyLabel={t('home.loadCharacter')}
            textareaClassName="h-28"
          />
        </div>
      </section>
      <div>
        <div className="lbl mb-3">{t('home.thenAsk')}</div>
        <QuestionCards />
      </div>
    </div>
  );
}

/** The landing page: a welcome for first visits, otherwise the loaded
 *  character with its latest numbers and a way into each tool. */
export default function Home() {
  const { t } = useLanguage();
  const { simcInput } = useSimContext();
  const info = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const race = useMemo(() => simcInput.match(/^race=(\w+)/m)?.[1] ?? null, [simcInput]);
  const realmSlug = useRealmSlug(info?.realm);
  const { resolved } = useResolvedGear(simcInput);
  const gear = useMemo(() => equippedGearItems(resolved), [resolved]);
  const { jobs } = useCharacterJobs(info?.name ?? null, info?.realm ?? null);
  const { jobs: active } = useActiveSims();
  const recentSource = useRecentJobs(useIsDesktop(), jobs);
  const rotation = useSeasonRotation();

  const backdrop = rotation?.[0] ? zoneBackground(rotation[0].image_url) : null;
  if (!info) return <Welcome backdrop={backdrop} />;

  const last = lastDoneBySimType(jobs);
  const lastRun: Record<string, string> = {};
  for (const tool of TOOLS) {
    const job = last[tool.simType];
    if (!job) continue;
    const when = timeAgo(job.created_at, t);
    lastRun[tool.simType] =
      tool.simType === 'quick' && job.dps
        ? `${Math.round(job.dps).toLocaleString()} DPS · ${when}`
        : t('home.lastRun', { when });
  }
  const running = active.filter(
    (j) =>
      isActiveStatus(j.status) &&
      j.player_name === info.name &&
      (!j.realm || j.realm === info.realm)
  );
  const recent = recentJobs(recentSource, 5);

  return (
    <div className="space-y-6">
      <HomeHero
        name={info.name}
        spec={info.spec}
        className={titleCase(info.className)}
        classColor={CLASS_COLORS[info.className]}
        race={race && titleCase(race)}
        realm={info.realm && titleCase(info.realm)}
        renderUrl={getCharacterRenderUrl(realmSlug, info.name, info.region)}
        backdrop={backdrop}
        dps={last.quick?.dps ?? null}
        itemLevel={gear ? averageItemLevel(gear) : null}
        trend={quickSimTrend(jobs)}
      />

      <div>
        <div className="lbl mb-3">{t('home.whatToKnow')}</div>
        <QuestionCards lastRun={lastRun} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className={CARD}>
          <CardHeader
            title={t('home.recentSims')}
            right={
              <Link href={ROUTES.sims} className="lbl !text-gold hover:!text-gold-light">
                {t('home.allSims')}
              </Link>
            }
          />
          {recent.length === 0 ? (
            <p className="px-6 py-5 text-[13px] text-outline">
              {t('home.noSimsYet', { name: info.name })}
            </p>
          ) : (
            recent.map((job, i) => {
              const avatar = getCharacterAvatarUrl(job.realm, job.player_name, job.region ?? 'eu');
              return (
                <Link
                  key={job.id}
                  href={`${SIM_RESULT_PREFIX}/${job.id}`}
                  className={`group grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-6 py-3 transition-colors hover:bg-overlay/[0.02] ${
                    i > 0 ? 'border-t border-line/[0.06]' : ''
                  }`}
                >
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatar}
                      alt=""
                      className="h-[34px] w-[34px] rounded-[8px] border border-line/[0.11] object-cover"
                    />
                  ) : (
                    <span className="h-[34px] w-[34px] rounded-[8px] bg-surface-container-highest" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-on-surface">
                      {getSimTypeLabel(job.sim_type, t)}
                      {job.player_name && (
                        <>
                          {' · '}
                          <span style={{ color: classColorOf(job.player_class) }}>
                            {job.player_name}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-outline">
                      {job.status === 'failed' ? (
                        <span className="text-negative">{t('home.simFailed')}</span>
                      ) : (
                        <>
                          {job.dps
                            ? `${Math.round(job.dps).toLocaleString()} DPS`
                            : job.fight_style}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="text-xs text-outline">{timeAgo(job.created_at, t)}</span>
                </Link>
              );
            })
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className={CARD}>
            <CardHeader title={t('home.runningNow')} />
            {running.length === 0 ? (
              <p className="px-6 py-5 text-[13px] text-outline">{t('home.nothingRunning')}</p>
            ) : (
              running.slice(0, 3).map((job, i) => (
                <Link
                  key={job.id}
                  href={`${SIM_RESULT_PREFIX}/${job.id}`}
                  className={`block px-6 py-4 ${i > 0 ? 'border-t border-line/[0.06]' : ''}`}
                >
                  <span className="flex items-center justify-between text-[13.5px] font-semibold text-on-surface">
                    {getSimTypeLabel(job.sim_type, t)}
                    <span className="rounded-[6px] bg-gold-tint px-2 py-0.5 text-[11px] text-gold">
                      {Math.round(job.progress_pct)}%
                    </span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                    <span
                      className="block h-full rounded-full bg-gold-fill"
                      style={{ width: `${Math.max(2, job.progress_pct)}%` }}
                    />
                  </span>
                  {job.progress_detail && (
                    <span className="mt-1.5 block text-xs text-outline">{job.progress_detail}</span>
                  )}
                </Link>
              ))
            )}
          </section>

          {rotation && (
            // Grows to meet the bottom of Recent sims.
            <section className={`${CARD} flex flex-1 flex-col`}>
              <CardHeader title={t('home.thisWeek')} />
              <div className="grid min-h-[150px] flex-1 auto-rows-fr grid-cols-4 gap-1.5 p-4">
                {rotation.slice(0, 8).map((d) => (
                  <div
                    key={d.name}
                    className="relative min-h-[56px] overflow-hidden rounded-[6px] bg-cover bg-center"
                    style={{ backgroundImage: `url(${d.image_url})` }}
                    title={d.name}
                  >
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3.5 text-[9.5px] font-bold text-white">
                      {d.name}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
