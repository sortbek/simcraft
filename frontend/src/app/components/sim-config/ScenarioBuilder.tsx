'use client';

import { useEffect, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { formatScenarioLabel } from '../../lib/scenario-siblings';
import { API_URL } from '../../lib/api';

export default function ScenarioBuilder() {
  const { t } = useLanguage();
  const { scenarios, addScenario, removeScenario, clearScenarios } = useSimContext();
  const [maxScenarios, setMaxScenarios] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/config`)
      .then((r) => r.json())
      .then((data) => setMaxScenarios(data.max_scenarios ?? 10))
      .catch(() => setMaxScenarios(10))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || maxScenarios === 0) return null;

  return (
    <div className="space-y-3 border-t border-outline-variant/10 pt-2">
      <div className="flex items-center justify-between">
        <label className="label-text">{t('config.scenarios')}</label>
        {scenarios.length > 0 && (
          <button
            type="button"
            onClick={clearScenarios}
            className="text-[13px] text-on-surface-variant/60 transition-colors hover:text-on-surface-variant"
          >
            {t('common.clearAll')}
          </button>
        )}
      </div>

      {scenarios.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[14px] text-on-surface-variant"
            >
              <span>{formatScenarioLabel(s)}</span>
              <button
                type="button"
                onClick={() => removeScenario(s.id)}
                className="ml-0.5 text-on-surface-variant/60 transition-colors hover:text-on-surface"
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addScenario}
          disabled={scenarios.length >= maxScenarios}
          className="text-[14px] font-medium text-gold transition-colors hover:text-gold/80 disabled:cursor-not-allowed disabled:text-on-surface-variant/40"
        >
          {t('config.addCurrentConfig')}
        </button>
        <p className="text-[13px] text-on-surface-variant/40">{t('config.scenarioHelp')}</p>
      </div>
    </div>
  );
}
