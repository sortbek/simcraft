"use client";

import { useSimContext } from "./SimContext";
import { formatScenarioLabel } from "../lib/scenario-siblings";

export default function ScenarioBuilder() {
  const { scenarios, addScenario, removeScenario, clearScenarios } = useSimContext();

  return (
    <div className="pt-2 border-t border-border space-y-3">
      <div className="flex items-center justify-between">
        <label className="label-text">Scenarios</label>
        {scenarios.length > 0 && (
          <button
            type="button"
            onClick={clearScenarios}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
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
              className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-gray-300"
            >
              <span>{formatScenarioLabel(s)}</span>
              <button
                type="button"
                onClick={() => removeScenario(s.id)}
                className="text-gray-500 hover:text-white transition-colors ml-0.5"
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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
          disabled={scenarios.length >= 10}
          className="text-[12px] font-medium text-gold hover:text-gold/80 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
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
