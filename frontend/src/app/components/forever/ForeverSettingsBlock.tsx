'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { COLUMN_TITLE, HELP, formatFightLength } from '../sim-config/settingsUi';
import { Chevron, useSimSettingsOpen } from '../sim-config/SimSettingsBlock';
import { buttonClass } from '../ui/Button';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import type { ForeverBuffs } from './useForeverBuffs';
import { useForeverProfiles } from './useForeverProfiles';
import { FIGHT_LENGTHS, ITERATIONS } from './useForeverSettings';

function Choice({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="lbl block">{label}</span>
      <div className={`${TABS_TRACK} !flex !flex-nowrap`}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            aria-pressed={value === o}
            className={`min-w-0 flex-1 !px-1.5 ${tabClass(value === o)}`}
          >
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleGroup({
  label,
  group,
  buffs,
}: {
  label: string;
  group: 'buff' | 'debuff';
  buffs: ForeverBuffs;
}) {
  return (
    <div className="space-y-2">
      <span className="lbl block">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {buffs.toggles
          .filter((t) => t.group === group)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={buffs.on.has(t.id)}
              onClick={() => buffs.toggle(t.id)}
              className={`chip ${buffs.on.has(t.id) ? 'chip-on' : ''}`}
            >
              {t.label}
            </button>
          ))}
      </div>
    </div>
  );
}

function ProfileRow({
  fightLength,
  setFightLength,
  iterations,
  setIterations,
  buffs,
}: {
  fightLength: number;
  setFightLength: (v: number) => void;
  iterations: number;
  setIterations: (v: number) => void;
  buffs: ForeverBuffs;
}) {
  const { t } = useLanguage();
  const { profiles, save, remove } = useForeverProfiles();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState('');
  const load = (profileName: string) => {
    setPicked(profileName);
    const profile = profiles.find((p) => p.name === profileName);
    if (!profile) return;
    setName(profile.name);
    if (FIGHT_LENGTHS.includes(profile.fightLength)) setFightLength(profile.fightLength);
    if (ITERATIONS.includes(profile.iterations)) setIterations(profile.iterations);
    buffs.apply(profile.buffs, profile.consumables);
  };
  const trimmed = name.trim();
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line/[0.06] px-5 py-3">
      <span className="lbl">{t('forever.profile')}</span>
      <select
        value={picked}
        onChange={(e) => load(e.target.value)}
        aria-label={t('forever.profile')}
        className="sel !w-auto min-w-[160px]"
      >
        <option value="">{t('forever.profilePick')}</option>
        {profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder={t('forever.profileName')}
        aria-label={t('forever.profileName')}
        className="sel !w-auto min-w-[160px]"
      />
      <button
        type="button"
        disabled={!trimmed}
        onClick={() => {
          save({
            name: trimmed,
            fightLength,
            iterations,
            buffs: [...buffs.on],
            consumables: buffs.consumables,
          });
          setPicked(trimmed);
        }}
        className={buttonClass('text', 'sm')}
      >
        {t('forever.profileSave')}
      </button>
      {picked && (
        <button
          type="button"
          onClick={() => {
            remove(picked);
            setPicked('');
          }}
          className={buttonClass('text', 'sm')}
        >
          {t('forever.profileDelete')}
        </button>
      )}
    </div>
  );
}

/** The retail Sim settings block, cut to what the Forever engine takes. `buffs` is null with an
 *  engine that lists no options; the build's own set runs then. */
export default function ForeverSettingsBlock({
  fightLength,
  setFightLength,
  iterations,
  setIterations,
  buffs,
  levelling,
}: {
  fightLength: number;
  setFightLength: (v: number) => void;
  iterations: number;
  setIterations: (v: number) => void;
  buffs: ForeverBuffs | null;
  levelling: boolean;
}) {
  const { t } = useLanguage();
  const { open, changeOpen, rootRef, keepTopRef } = useSimSettingsOpen();
  const auto = t('simSettings.auto');
  const summary = [
    { label: t('simSettings.fight'), value: formatFightLength(fightLength) },
    { label: t('config.iterations'), value: iterations.toLocaleString() },
    {
      label: t('config.consumables'),
      // Below 60 the server keeps them off whatever the toggle says.
      value: buffs ? t(buffs.consumables && !levelling ? 'forever.on' : 'forever.off') : auto,
    },
    {
      label: t('config.raidBuffs'),
      value: buffs
        ? t('simSettings.buffsActive', { on: buffs.on.size, total: buffs.toggles.length })
        : auto,
    },
  ];
  return (
    <section
      ref={rootRef}
      id="sim-settings"
      aria-label={t('simSettings.title')}
      className="card sim-settings scroll-mt-24"
    >
      <div className="flex items-start gap-3 rounded-t-[10px] py-2.5 pl-5 pr-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-h-10 items-center">
            <h2 className="h-card">{t('simSettings.title')}</h2>
          </div>
          {!open && (
            <div className="sim-settings-summary">
              {summary.map((item) => (
                <div key={item.label} className="sim-settings-summary-item">
                  <span className="lbl">{item.label}</span>
                  <b className="truncate font-headline text-[13px] font-extrabold text-on-surface">
                    {item.value}
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            keepTopRef.current = rootRef.current?.getBoundingClientRect().top ?? null;
            changeOpen(!open);
          }}
          aria-expanded={open}
          aria-label={open ? t('simSettings.collapse') : t('simSettings.expand')}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-line/[0.11] text-on-surface-variant transition-colors hover:border-line/20 hover:text-on-surface"
        >
          <Chevron up={open} />
        </button>
      </div>
      {open && (
        <>
          <div className="sim-settings-grid">
            <div className="sim-settings-col sim-settings-fight">
              <h3 className={COLUMN_TITLE}>{t('simSettings.fight')}</h3>
              <Choice
                label={t('config.fightLength')}
                value={fightLength}
                options={FIGHT_LENGTHS}
                format={formatFightLength}
                onChange={setFightLength}
              />
              <Choice
                label={t('config.iterations')}
                value={iterations}
                options={ITERATIONS}
                format={(n) => n.toLocaleString()}
                onChange={setIterations}
              />
            </div>
            <div className="sim-settings-col sim-settings-cons">
              <h3 className={COLUMN_TITLE}>{t('config.consumables')}</h3>
              {buffs && !levelling ? (
                <>
                  <button
                    type="button"
                    aria-pressed={buffs.consumables}
                    onClick={() => buffs.setConsumables(!buffs.consumables)}
                    className={`chip ${buffs.consumables ? 'chip-on' : ''}`}
                  >
                    {t('forever.buildConsumables')}
                  </button>
                  <p className={HELP}>{t('forever.consumablesHelp')}</p>
                </>
              ) : (
                <p className={HELP}>
                  {t(levelling ? 'forever.consumablesLevelling' : 'forever.autoConsumables')}
                </p>
              )}
            </div>
            <div className="sim-settings-col sim-settings-buffs">
              <h3 className={COLUMN_TITLE}>{t('config.raidBuffs')}</h3>
              {buffs ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="lbl">
                      {t('simSettings.buffsActive', {
                        on: buffs.on.size,
                        total: buffs.toggles.length,
                      })}
                    </span>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => buffs.setAll(true)}
                        className={buttonClass('text', 'sm')}
                      >
                        {t('simSettings.all')}
                      </button>
                      <button
                        type="button"
                        onClick={() => buffs.setAll(false)}
                        className={buttonClass('text', 'sm')}
                      >
                        {t('simSettings.none')}
                      </button>
                      {!buffs.isDefault && (
                        <button
                          type="button"
                          onClick={buffs.reset}
                          title={t('forever.resetBuffsHint')}
                          className={buttonClass('text', 'sm')}
                        >
                          {t('common.reset')}
                        </button>
                      )}
                    </div>
                  </div>
                  <ToggleGroup label={t('forever.buffs')} group="buff" buffs={buffs} />
                  <ToggleGroup label={t('forever.debuffs')} group="debuff" buffs={buffs} />
                </div>
              ) : (
                <p className={HELP}>{t('forever.autoBuffs')}</p>
              )}
            </div>
          </div>
          {buffs && (
            <ProfileRow
              fightLength={fightLength}
              setFightLength={setFightLength}
              iterations={iterations}
              setIterations={setIterations}
              buffs={buffs}
            />
          )}
        </>
      )}
    </section>
  );
}
