'use client';

import { useEffect, useState } from 'react';
import { useSimContext } from './SimContext';
import { formatScenarioLabel } from '../lib/scenario-siblings';
import { API_URL } from '../lib/api';

export default function ScenarioBuilder() {
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
    <div className="space-y-3 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <label className="label-text">Scenarios</label>
        {scenarios.length > 0 && (
          <button
            type="button"
            onClick={clearScenarios}
            className="text-[11px] text-gray-500 transition-colors hover:text-gray-300"
          >
            Clear all
          </button>
        )}
      </div>

      {scenarios.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-gray-300"
            >
              <span>{formatScenarioLabel(s)}</span>
              <button
                type="button"
                onClick={() => removeScenario(s.id)}
                className="ml-0.5 text-gray-500 transition-colors hover:text-white"
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
          className="text-[12px] font-medium text-gold transition-colors hover:text-gold/80 disabled:cursor-not-allowed disabled:text-gray-600"
        >
          + Add current config
        </button>
        <p className="text-[11px] text-gray-600">
          Run multiple fight configurations with the same setup
        </p>
      </div>
    </div>
  );
}
