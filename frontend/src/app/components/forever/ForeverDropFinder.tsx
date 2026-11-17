'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import Checkbox from '../ui/Checkbox';
import Pill from '../ui/Pill';
import { cn } from '../../lib/cn';
import { useLanguage } from '../../lib/i18n';
import { useSimContext } from '../sim-config/SimContext';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsBlock from './ForeverSettingsBlock';
import ForeverTalentCard from './ForeverTalentCard';
import ForeverWarnings from './ForeverWarnings';
import { blockedReason } from './specs';
import type { ForeverDropSource } from './types';
import { useForeverBuffs } from './useForeverBuffs';
import { useForeverDropSources } from './useForeverDropSources';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSpec } from './useForeverSpec';
import { useForeverSubmit } from './useForeverSubmit';
import { useForeverTalents } from './useForeverTalents';

const CATEGORIES: ForeverDropSource['category'][] = [
  'dungeon',
  'raid',
  'quest',
  'reputation',
  'crafted',
  'vendor',
  'pvp',
  'world',
];

/** Sources with gear that fits first; instances by entry level, the rest by name. */
function bySourceOrder(a: ForeverDropSource, b: ForeverDropSource) {
  if (a.count > 0 !== b.count > 0) return a.count > 0 ? -1 : 1;
  return a.level - b.level || a.name.localeCompare(b.name);
}

function SourceRow({
  source,
  checked,
  onToggle,
  level,
}: {
  source: ForeverDropSource;
  checked: boolean;
  onToggle: () => void;
  level: number;
}) {
  const { t } = useLanguage();
  const fits = source.count > 0;
  const levels =
    source.level > 0
      ? `L${source.level}`
      : fits && source.min_level != null && source.max_level != null
        ? source.min_level === source.max_level
          ? `L${source.min_level}`
          : `L${source.min_level}–${source.max_level}`
        : '';
  const standings = source.standings
    ? source.standings[0] === source.standings[1]
      ? t(`forever.drops.standing.${source.standings[0]}`)
      : t('forever.drops.standingRange', {
          from: t(`forever.drops.standing.${source.standings[0]}`),
          to: t(`forever.drops.standing.${source.standings[1]}`),
        })
    : '';
  const detail = [levels, source.zone, standings].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      disabled={!fits}
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[6px] border px-3 py-2.5 text-left transition-colors',
        checked
          ? 'border-gold-fill/60 bg-gold/[0.06]'
          : 'border-outline-variant/40 hover:bg-overlay/[0.04]',
        !fits && 'cursor-default opacity-50 hover:bg-transparent'
      )}
    >
      <Checkbox checked={checked} aria-label={source.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-on-surface">{source.name}</span>
          {source.new && (
            <Pill size="sm" variant="info">
              {t('forever.drops.new')}
            </Pill>
          )}
        </span>
        {detail && (
          <span
            className={cn(
              'block truncate text-xs tabular-nums',
              source.level > level ? 'text-outline' : 'text-on-surface-variant'
            )}
          >
            {detail}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-on-surface-variant">
        {fits
          ? t('forever.drops.count', { count: source.count })
          : source.total === 0
            ? t('forever.drops.noneKnown')
            : t('forever.drops.noneFit')}
      </span>
    </button>
  );
}

export default function ForeverDropFinder() {
  const { simcInput } = useSimContext();
  const { t } = useLanguage();
  const talents = useForeverTalents(simcInput);
  const { summary, error } = useForeverImport(simcInput, talents.edited);
  const { sources, error: sourcesError } = useForeverDropSources(simcInput);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useForeverSpec(simcInput, summary?.spec_key ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set()), [simcInput]);

  const sections = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        sources: (sources?.groups ?? []).filter((g) => g.category === category).sort(bySourceOrder),
      })).filter((s) => s.sources.length > 0),
    [sources]
  );
  const itemCount = useMemo(
    () =>
      (sources?.groups ?? []).filter((g) => picked.has(g.key)).reduce((sum, g) => sum + g.count, 0),
    [sources, picked]
  );

  const blocked = summary ? blockedReason(summary.level, summary.has_sheet, specKey) : null;
  const buffs = useForeverBuffs((specKey && summary?.sim_options?.[specKey]) || null);
  const buildPayload = useCallback(
    () =>
      summary && !blocked && picked.size > 0
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            talents_string: talents.edited ?? undefined,
            sources: [...picked],
          }
        : null,
    [
      summary,
      blocked,
      picked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.edited,
    ]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/drop-finder', buildPayload);
  const buildComparePayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            builds: [
              {
                name: t('forever.exportedTalents'),
                talents_string: summary.exported_talents_string,
              },
              ...talents.builds,
            ],
          }
        : null,
    [
      summary,
      blocked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.builds,
      t,
    ]
  );
  const compare = useForeverSubmit('/api/forever/talent-compare', buildComparePayload);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleSection = (keys: string[]) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const all = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const status = blocked
    ? t(`forever.blocked.${blocked}`)
    : picked.size === 0
      ? t('forever.drops.pickSources')
      : t('forever.drops.picked', { sources: picked.size, items: itemCount });

  return (
    <>
      {error && <ErrorAlert message={error} />}
      {sourcesError && <ErrorAlert message={sourcesError} />}
      {summary && (
        <>
          <ForeverSettingsBlock
            {...settings}
            buffs={buffs}
            levelling={(summary?.level ?? 60) < 60}
          />
          <ForeverTalentCard
            summary={summary}
            specKey={specKey}
            onSpecChange={setSpecKey}
            talents={talents}
            compare={compare}
          />
          <ForeverWarnings warnings={summary.warnings} />
          {sources && !sources.available && (
            <p className="card px-6 py-5 text-sm text-outline">{t('forever.drops.unavailable')}</p>
          )}
          {sections.map(({ category, sources: rows }) => {
            const fitting = rows.filter((r) => r.count > 0).map((r) => r.key);
            const pickedHere = fitting.filter((k) => picked.has(k)).length;
            return (
              <section key={category} className="card space-y-3 px-4 py-4">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="lbl">{t(`forever.drops.category.${category}`)}</h2>
                  {fitting.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleSection(fitting)}
                      className="text-xs text-on-surface-variant hover:text-on-surface"
                    >
                      {pickedHere === fitting.length
                        ? t('forever.drops.pickNone')
                        : t('forever.drops.pickAll', { count: fitting.length })}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {rows.map((source) => (
                    <SourceRow
                      key={source.key}
                      source={source}
                      checked={picked.has(source.key)}
                      onToggle={() => toggle(source.key)}
                      level={summary.level}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
      <ErrorAlert message={submitError} />
      <ForeverFooter
        onSubmit={submit}
        submitting={submitting}
        disabled={!summary || !!blocked || picked.size === 0}
        label={t('button.findUpgrades')}
        status={summary ? status : null}
      />
    </>
  );
}
