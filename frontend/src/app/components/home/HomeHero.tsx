'use client';
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useLanguage } from '../../lib/i18n';
import { ROUTES } from '../../lib/routes';
import { specDisplayName } from '../../lib/types';
import { buttonClass } from '../ui/Button';
import { renderCentreShift, useTrimmedRender } from '../gear/useTrimmedRender';
import { trendChange } from './homeModel';
import { HomeIcon } from './HomeIcons';

interface HomeHeroProps {
  name: string;
  spec: string;
  className: string;
  classColor?: string;
  race: string | null;
  realm: string | null;
  renderUrl: string | null;
  backdrop: string | null;
  dps: number | null;
  itemLevel: number | null;
  trend: number[];
}

function Sparkline({ values }: { values: number[] }) {
  const w = 300;
  const h = 44;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [
    (i * w) / (values.length - 1),
    h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 10),
  ]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      className="block h-11 w-full overflow-visible"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="home-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--c-primary))" stopOpacity=".35" />
          <stop offset="1" stopColor="rgb(var(--c-primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill="url(#home-spark)" />
      <polyline
        points={line}
        fill="none"
        stroke="rgb(var(--c-primary))"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r="3.5" fill="rgb(var(--c-primary))" />
    </svg>
  );
}

/** The loaded character in the spotlight, with its latest numbers. */
export default function HomeHero({
  name,
  spec,
  className,
  classColor,
  race,
  realm,
  renderUrl,
  backdrop,
  dps,
  itemLevel,
  trend,
}: HomeHeroProps) {
  const { t } = useLanguage();
  const render = useTrimmedRender(renderUrl);
  const change = trendChange(trend);

  return (
    <section className="relative grid min-h-[360px] grid-cols-1 overflow-hidden rounded-[16px] border border-line/[0.06] bg-surface-container-lowest md:grid-cols-[minmax(260px,38%)_1fr]">
      {backdrop && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-30 saturate-[.8] after:absolute after:inset-0 after:bg-[linear-gradient(90deg,rgb(var(--c-background)/.2),rgb(var(--c-background)/.85)_45%,rgb(var(--c-background)/.97)),linear-gradient(0deg,rgb(var(--c-background)/.9),transparent_50%)] after:content-['']"
          style={{ backgroundImage: backdrop }}
        />
      )}

      <div className="relative min-h-[300px]">
        <div className="pointer-events-none absolute -inset-x-[25%] -top-[10%] bottom-0 bg-[radial-gradient(ellipse_42%_55%_at_50%_40%,rgb(var(--c-gold-light)/0.16),rgb(var(--c-gold-light)/0.04)_45%,transparent_70%)]" />
        <div className="pointer-events-none absolute bottom-3 left-1/2 h-[30px] w-1/2 -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.7),transparent_70%)]" />
        {render.status === 'trimmed' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[18px] h-[88%]">
            <img
              src={render.src}
              alt=""
              className="absolute bottom-0 left-1/2 h-full w-auto max-w-none [filter:drop-shadow(0_18px_24px_rgba(0,0,0,0.55))]"
              style={{ transform: `translateX(-${renderCentreShift(render.bounds)}%)` }}
            />
          </div>
        )}
      </div>

      <div className="relative flex flex-col justify-center gap-3.5 px-8 pb-8 pt-2 md:py-10 md:pl-2 md:pr-10">
        <span className="lbl">{t('home.welcomeBack')}</span>
        <h1 className="font-headline text-[44px] font-extrabold leading-none tracking-[-0.01em] text-on-surface">
          {name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-on-surface-variant">
          <span
            className="rounded-[6px] bg-overlay/[0.06] px-2 py-[3px] text-[11.5px] font-semibold"
            style={{ color: classColor }}
          >
            {specDisplayName(spec)} {className}
          </span>
          <span>{[race, realm].filter(Boolean).join(' · ')}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-end gap-9">
          <div>
            <div className="font-headline text-[34px] font-extrabold tabular-nums leading-none text-gold">
              {dps != null ? Math.round(dps).toLocaleString() : '—'}
            </div>
            <div className="lbl mt-2">{t('home.dpsQuickSim')}</div>
          </div>
          <div>
            <div className="font-headline text-[34px] font-extrabold tabular-nums leading-none text-on-surface">
              {itemLevel != null ? itemLevel.toFixed(1) : '—'}
            </div>
            <div className="lbl mt-2">{t('home.itemLevel')}</div>
          </div>
          {trend.length >= 2 && (
            <div className="min-w-[200px] max-w-[320px] flex-1">
              <Sparkline values={trend} />
              <div className="lbl mt-1.5">
                {t('home.lastSims', { count: trend.length })}
                {change != null && (
                  <span className={change >= 0 ? 'text-positive' : 'text-negative'}>
                    {' · '}
                    {change >= 0 ? '+' : ''}
                    {(change * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-2.5">
          <Link href={ROUTES.quickSim} className={buttonClass('solid', 'lg')}>
            <HomeIcon name="quick" className="h-4 w-4" />
            {t('home.simAgain')}
          </Link>
          <Link href={ROUTES.topGear} className={buttonClass('gold', 'lg')}>
            <HomeIcon name="top" className="h-4 w-4" />
            {t('home.findTopGear')}
          </Link>
        </div>
      </div>
    </section>
  );
}
