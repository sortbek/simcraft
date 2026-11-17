'use client';
/* eslint-disable @next/next/no-img-element */

import { useLanguage } from '../../lib/i18n';
import type {
  ForeverAbilityDetail,
  ForeverFlow,
  ForeverUptime,
  QuickSimResult,
} from '../../lib/simResultTypes';
import ForeverTimeline, { ForeverOpener } from './ForeverTimeline';
import { iconProps } from '../../lib/useItemInfo';

function Icon({ icon }: { icon?: string | null }) {
  return icon ? (
    <img
      alt=""
      {...iconProps(icon)}
      className="h-6 w-6 shrink-0 rounded-[5px] border border-line/[0.11] object-cover"
    />
  ) : (
    <span className="h-6 w-6 shrink-0 rounded-[5px] border border-line/[0.11]" />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] flex-1 px-5 py-4">
      <span className="lbl block">{label}</span>
      <b className="mt-1.5 block font-headline text-[17px] font-extrabold tabular-nums text-on-surface">
        {value}
      </b>
    </div>
  );
}

function Spread({ hist }: { hist: [number, number][] }) {
  const most = Math.max(1, ...hist.map(([, fights]) => fights));
  return (
    <div className="flex h-24 items-end gap-1.5">
      {hist.map(([bucket, fights]) => (
        <div key={bucket} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div
            title={fights.toLocaleString()}
            className="w-full rounded-t-[3px] bg-gold-fill"
            style={{ height: `${Math.max(2, (fights / most) * 72)}px` }}
          />
          <span className="text-[11px] tabular-nums text-outline">{bucket}</span>
        </div>
      ))}
    </div>
  );
}

function Abilities({ rows, unit }: { rows: ForeverAbilityDetail[]; unit: string }) {
  const { t } = useLanguage();
  const total = rows.reduce((sum, r) => sum + r.dps, 0) || 1;
  const num = 'px-3 py-2.5 text-right tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-line/[0.06]">
            <th className="lbl px-5 py-2.5 text-left">{t('forever.details.ability')}</th>
            <th className={`lbl ${num}`}>{unit}</th>
            <th className={`lbl ${num}`}>{t('forever.details.share')}</th>
            <th className={`lbl ${num}`}>{t('forever.details.casts')}</th>
            <th className={`lbl ${num}`}>{t('forever.details.perCast')}</th>
            <th className={`lbl ${num}`}>{t('forever.details.crit')}</th>
            <th className={`lbl ${num} pr-5`}>{t('forever.details.miss')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.owner}:${r.name}`}
              className="border-b border-line/[0.06] last:border-b-0"
            >
              <td className="px-5 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon icon={r.icon} />
                  <span className="truncate font-semibold text-on-surface">
                    {r.owner ? `${r.owner}: ${r.name}` : r.name}
                  </span>
                </span>
              </td>
              <td className={`${num} font-headline font-extrabold text-on-surface`}>
                {r.dps.toFixed(1)}
              </td>
              <td className={`${num} text-on-surface-variant`}>
                {((r.dps / total) * 100).toFixed(1)}%
              </td>
              <td className={`${num} text-on-surface-variant`}>{r.casts ? r.casts : '-'}</td>
              <td className={`${num} text-on-surface-variant`}>
                {r.per_cast ? Math.round(r.per_cast).toLocaleString() : '-'}
              </td>
              <td className={`${num} text-on-surface-variant`}>
                {r.casts ? `${r.crit_pct.toFixed(1)}%` : '-'}
              </td>
              <td className={`${num} pr-5 text-on-surface-variant`}>
                {r.casts ? `${r.miss_pct.toFixed(1)}%` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Uptimes({ title, rows }: { title: string; rows: ForeverUptime[] }) {
  return (
    <div className="min-w-0 flex-1 space-y-2.5 px-5 py-4">
      <span className="lbl block">{title}</span>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2.5 text-[13px]">
          <Icon icon={r.icon} />
          <span className="min-w-0 flex-1 truncate font-semibold text-on-surface">{r.name}</span>
          <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-gold-fill"
              style={{ width: `${r.uptime_pct}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums text-on-surface-variant">
            {r.uptime_pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function Flow({ title, rows }: { title: string; rows: ForeverFlow[] }) {
  const most = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="min-w-0 flex-1 space-y-2.5 px-5 py-4">
      <span className="lbl block">{title}</span>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2.5 text-[13px]">
          <Icon icon={r.icon} />
          <span className="min-w-0 flex-1 truncate font-semibold text-on-surface">{r.name}</span>
          <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-gold-fill"
              style={{ width: `${(r.amount / most) * 100}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums text-on-surface-variant">
            {Math.round(r.amount).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/** `raid.giftOfTheWild` to "Gift of the Wild", as the settings block labels it. */
function toggleLabel(id: string): string {
  const key = id.slice(id.indexOf('.') + 1);
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ (Of|The) /g, (m) => m.toLowerCase());
}

/** What the Forever engine reports beyond the damage breakdown: the spread of the fights, each
 *  ability's casts and crits, aura uptimes and what the sim ran with. */
export default function ForeverResultDetails({ result }: { result: QuickSimResult }) {
  const { t } = useLanguage();
  const details = result.ability_details ?? [];
  if (details.length === 0) return null;
  const unit = t(result.metric === 'hps' ? 'results.hps' : 'results.dps');
  const settings = result.sim_settings;
  const buffs = result.buffs ?? [];
  const debuffs = result.debuffs ?? [];
  const hist = result.dps_hist ?? [];
  // What the runner really ran with, where it reports it; else the ids that were picked.
  const ran = settings?.applied;
  const sets = ran ? [ran.raidBuffs, ran.partyBuffs, ran.playerBuffs, ran.debuffs] : [];
  const shown = ran
    ? sets.flatMap((set) =>
        Object.entries(set ?? {})
          .filter(([, value]) => value && value !== 'TristateEffectMissing')
          .map(([key]) => toggleLabel(key))
      )
    : (settings?.buffs?.map(toggleLabel) ?? null);
  return (
    <>
      <section className="card">
        <div className="flex flex-wrap divide-x divide-line/[0.06]">
          <Stat
            label={t('forever.details.range')}
            value={`${Math.round(result.dps_min ?? 0)} - ${Math.round(result.dps_max ?? 0)}`}
          />
          <Stat
            label={t('forever.details.error')}
            value={`± ${(result.dps_error ?? 0).toFixed(1)} (${(result.dps_error_pct ?? 0).toFixed(2)}%)`}
          />
          <Stat label={t('forever.details.stdev')} value={(result.dps_stdev ?? 0).toFixed(1)} />
          {result.dps_median != null && (
            <Stat label={t('forever.details.median')} value={result.dps_median.toFixed(1)} />
          )}
          {(result.apm ?? 0) > 0 && (
            <Stat label={t('forever.details.apm')} value={(result.apm ?? 0).toFixed(1)} />
          )}
          {(result.oom_seconds ?? 0) > 0 && (
            <Stat
              label={t('forever.details.oom')}
              value={t('forever.details.seconds', { count: Math.round(result.oom_seconds ?? 0) })}
            />
          )}
        </div>
        {hist.length > 1 && (
          <div className="border-t border-line/[0.06] px-5 py-4">
            <span className="lbl mb-3 block">{t('forever.details.spread', { unit })}</span>
            <Spread hist={hist} />
          </div>
        )}
      </section>

      {result.timeline && result.timeline.casts.length > 0 && (
        <section className="card">
          <div className="px-5 py-3.5">
            <h2 className="h-card">{t('forever.details.timeline')}</h2>
          </div>
          <div className="space-y-5 border-t border-line/[0.06] px-5 py-4">
            <div className="space-y-2.5">
              <span className="lbl block">{t('forever.details.opener')}</span>
              <ForeverOpener timeline={result.timeline} />
            </div>
            <ForeverTimeline timeline={result.timeline} />
            <p className="text-xs text-outline">{t('forever.details.timelineHint')}</p>
          </div>
        </section>
      )}

      <section className="card">
        <div className="px-5 py-3.5">
          <h2 className="h-card">{t('forever.details.abilities')}</h2>
        </div>
        <div className="border-t border-line/[0.06]">
          <Abilities rows={details} unit={unit} />
        </div>
      </section>

      {(buffs.length > 0 || debuffs.length > 0) && (
        <section className="card">
          <div className="px-5 py-3.5">
            <h2 className="h-card">{t('forever.details.uptimes')}</h2>
          </div>
          <div className="flex flex-col border-t border-line/[0.06] md:flex-row md:divide-x md:divide-line/[0.06]">
            {buffs.length > 0 && <Uptimes title={t('forever.buffs')} rows={buffs} />}
            {debuffs.length > 0 && <Uptimes title={t('forever.debuffs')} rows={debuffs} />}
          </div>
        </section>
      )}

      {result.mana && (result.mana.gains.length > 0 || result.mana.spends.length > 0) && (
        <section className="card">
          <div className="px-5 py-3.5">
            <h2 className="h-card">{t('forever.details.mana')}</h2>
          </div>
          <div className="flex flex-col border-t border-line/[0.06] md:flex-row md:divide-x md:divide-line/[0.06]">
            <Flow title={t('forever.details.manaGained')} rows={result.mana.gains} />
            <Flow title={t('forever.details.manaSpent')} rows={result.mana.spends} />
          </div>
          {result.mana.wasted > 0 && (
            <p className="border-t border-line/[0.06] px-5 py-3 text-xs text-outline">
              {t('forever.details.manaWasted', { amount: Math.round(result.mana.wasted) })}
            </p>
          )}
        </section>
      )}

      {result.rotation && result.rotation.lines.length > 0 && (
        <section className="card">
          <div className="flex flex-wrap items-baseline gap-x-3 px-5 py-3.5">
            <h2 className="h-card">{t('forever.details.rotation')}</h2>
            {result.rotation.id && (
              <span className="text-xs text-outline">{result.rotation.id}</span>
            )}
          </div>
          <div className="space-y-4 border-t border-line/[0.06] px-5 py-4 text-[13px]">
            {result.rotation.prepull.length > 0 && (
              <div className="space-y-1.5">
                <span className="lbl block">{t('forever.details.prepull')}</span>
                {result.rotation.prepull.map((p, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-12 shrink-0 text-right tabular-nums text-outline">
                      {p.at}
                    </span>
                    <span className="font-semibold text-on-surface">{p.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <span className="lbl block">{t('forever.details.priority')}</span>
              {result.rotation.lines.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 text-right tabular-nums text-outline">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold text-on-surface">{line.text}</span>
                    {line.condition && (
                      <span className="text-on-surface-variant">
                        {' '}
                        {t('forever.details.when', { condition: line.condition })}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {settings && (
        <section className="card">
          <div className="px-5 py-3.5">
            <h2 className="h-card">{t('forever.details.settings')}</h2>
          </div>
          <div className="flex flex-wrap divide-x divide-line/[0.06] border-t border-line/[0.06]">
            <Stat label={t('forever.details.level')} value={String(settings.level)} />
            <Stat
              label={t('forever.details.target')}
              value={
                ran?.target
                  ? t('forever.details.targetArmor', {
                      level: ran.target.level,
                      armor: Math.round(ran.target.armor).toLocaleString(),
                    })
                  : String(settings.target_level)
              }
            />
            <Stat
              label={t('config.consumables')}
              value={
                settings.consumables == null
                  ? t('forever.details.buildDefault')
                  : t(settings.consumables ? 'forever.on' : 'forever.off')
              }
            />
            <Stat label={t('talent.points')} value={settings.talents_string || '-'} />
          </div>
          <div className="border-t border-line/[0.06] px-5 py-4">
            <span className="lbl mb-2 block">{t('config.raidBuffs')}</span>
            {shown == null ? (
              <span className="text-[13px] text-on-surface-variant">
                {t('forever.details.buildDefault')}
              </span>
            ) : shown.length === 0 ? (
              <span className="text-[13px] text-on-surface-variant">{t('simSettings.none')}</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {shown.map((label) => (
                  <span key={label} className="chip chip-on">
                    {label}
                  </span>
                ))}
              </span>
            )}
          </div>
        </section>
      )}
    </>
  );
}
