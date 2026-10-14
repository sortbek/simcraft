'use client';

import { useLanguage } from '../../lib/i18n';
import { FIGHT_LENGTHS, ITERATIONS } from './useForeverSettings';

const SELECT =
  'h-8 rounded-[6px] border border-line/[0.06] bg-surface-container-highest px-2 text-sm';

export default function ForeverSettingsCard({
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
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
      <label className="flex items-center gap-2">
        <span className="lbl">{t('forever.fightLength')}</span>
        <select
          value={fightLength}
          onChange={(e) => setFightLength(Number(e.target.value))}
          className={SELECT}
        >
          {FIGHT_LENGTHS.map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="lbl">{t('forever.iterations')}</span>
        <select
          value={iterations}
          onChange={(e) => setIterations(Number(e.target.value))}
          className={SELECT}
        >
          {ITERATIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-on-surface-variant">{t('forever.autoPresets')}</p>
    </div>
  );
}
