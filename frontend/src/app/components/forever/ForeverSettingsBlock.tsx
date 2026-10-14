'use client';

import { useLanguage } from '../../lib/i18n';
import { COLUMN_TITLE, HELP, formatFightLength } from '../sim-config/settingsUi';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
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

/** The retail Sim settings block, cut to what the Forever engine takes: consumables and
 *  buffs come from the spec's preset. */
export default function ForeverSettingsBlock({
  fightLength,
  setFightLength,
  iterations,
  setIterations,
}: {
  fightLength: number;
  setFightLength: (v: number) => void;
  iterations: number;
  setIterations: (v: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <section aria-label={t('simSettings.title')} className="card sim-settings">
      <div className="flex min-h-[60px] items-center py-2.5 pl-5 pr-3">
        <h2 className="h-card">{t('simSettings.title')}</h2>
      </div>
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
          <p className={HELP}>{t('forever.autoConsumables')}</p>
        </div>
        <div className="sim-settings-col sim-settings-buffs">
          <h3 className={COLUMN_TITLE}>{t('config.raidBuffs')}</h3>
          <p className={HELP}>{t('forever.autoBuffs')}</p>
        </div>
      </div>
    </section>
  );
}
