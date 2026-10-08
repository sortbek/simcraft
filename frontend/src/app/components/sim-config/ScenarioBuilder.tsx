'use client';

import { useEffect, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { formatScenarioLabel } from '../../lib/scenario-siblings';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import { buttonClass } from '../ui/Button';

export default function ScenarioBuilder() {
  const { t } = useLanguage();
  const { scenarios, addScenario, removeScenario, clearScenarios, isDungeonRoute, activeRoute } =
    useSimContext();
  const [maxScenarios, setMaxScenarios] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchJsonOr<{ max_scenarios?: number }>(apiUrl('/api/config'), {})
      .then((data) => setMaxScenarios(data.max_scenarios ?? 10))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || maxScenarios === 0) return null;

  // Scenarios can't coexist with a route: a loaded route (incl. footer on Patchwerk)
  // applies to every run, so useSimSubmit ignores queued scenarios — hide to match.
  if (isDungeonRoute || activeRoute) return null;

  return (
    <div className="space-y-3 border-t border-line/[0.06] pt-4">
      <div className="flex items-center justify-between">
        <label className="lbl">{t('config.scenarios')}</label>
        {scenarios.length > 0 && (
          <button type="button" onClick={clearScenarios} className={buttonClass('text')}>
            {t('common.clearAll')}
          </button>
        )}
      </div>

      {scenarios.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => (
            <div key={s.id} className="chip text-on-surface-variant">
              <span>{formatScenarioLabel(s)}</span>
              <button
                type="button"
                onClick={() => removeScenario(s.id)}
                className="ml-0.5 text-outline transition-colors hover:text-on-surface"
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={addScenario}
          disabled={scenarios.length >= maxScenarios}
          className={buttonClass('gold')}
        >
          {t('config.addCurrentConfig')}
        </button>
        <p className="text-[13px] text-outline">{t('config.scenarioHelp')}</p>
      </div>
    </div>
  );
}
