'use client';

import { useSimContext, type RotationMode } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import { HELP, VALUE, VALUE_INPUT, rangeFill } from './settingsUi';

const ROTATION_MODES: { value: RotationMode; labelKey: string; hintKey: string | null }[] = [
  { value: 'default', labelKey: 'config.rotationModeDefault', hintKey: null },
  {
    value: 'assisted_combat',
    labelKey: 'config.rotationModeAssisted',
    hintKey: 'config.rotationModeAssistedHint',
  },
  {
    value: 'one_button',
    labelKey: 'config.rotationModeOneButton',
    hintKey: 'config.rotationModeOneButtonHint',
  },
];

/** Fight column of the Sim settings block: style, length, targets, rotation and
 *  scenarios. Length and targets are owned by a dungeon route, so they hide in
 *  Dungeon Route mode. */
export default function FightSettings() {
  const { t } = useLanguage();
  const {
    fightStyle,
    setFightStyle,
    isDungeonRoute,
    fightLength,
    setFightLength,
    targetCount,
    setTargetCount,
    rotationMode,
    setRotationMode,
  } = useSimContext();
  const activeHint = ROTATION_MODES.find((m) => m.value === rotationMode)?.hintKey;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="lbl block">{t('config.fightStyle')}</label>
        <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
      </div>

      {!isDungeonRoute && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="lbl block">{t('config.fightLength')}</label>
              <div className="flex items-baseline gap-1">
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={fightLength}
                  onChange={(event) =>
                    setFightLength(Math.max(10, Math.min(3600, Number(event.target.value) || 0)))
                  }
                  className={`w-14 ${VALUE_INPUT}`}
                />
                <span className={VALUE}>{t('config.sec')}</span>
              </div>
            </div>
            <input
              type="range"
              min={30}
              max={1800}
              step={30}
              value={Math.min(fightLength, 1800)}
              onChange={(event) => setFightLength(Number(event.target.value))}
              style={rangeFill(fightLength, 30, 1800)}
              className="range"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="lbl block">{t('config.numberOfBosses')}</label>
              <span className={`tabular-nums ${VALUE}`}>
                {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={targetCount}
              onChange={(event) => setTargetCount(Number(event.target.value))}
              style={rangeFill(targetCount, 1, 10)}
              className="range"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <label className="lbl block">{t('config.rotationMode')}</label>
        <div className={`${TABS_TRACK} !flex !flex-nowrap`}>
          {ROTATION_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setRotationMode(mode.value)}
              aria-pressed={rotationMode === mode.value}
              title={mode.hintKey ? t(mode.hintKey) : undefined}
              className={`min-w-0 flex-1 !px-1.5 ${tabClass(rotationMode === mode.value)} !h-auto min-h-7 py-1 leading-tight`}
            >
              {t(mode.labelKey)}
            </button>
          ))}
        </div>
        <p className={HELP}>
          {activeHint ? `${t(activeHint)} · ` : ''}
          {t('config.rotationModeDpsOnly')}
        </p>
      </div>

      <ScenarioBuilder />
    </div>
  );
}
