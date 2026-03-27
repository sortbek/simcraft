'use client';

import { useState } from 'react';
import { useSimContext } from '../components/SimContext';
import { API_URL } from '../lib/api';
import { storeScenarioSiblings, clearScenarioSiblings } from '../lib/scenario-siblings';

export default function QuickSimPage() {
  const {
    simcInput,
    fightStyle,
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    customApl,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    scenarios,
    clearScenarios,
  } = useSimContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (simcInput.trim().length < 10) {
      setError('SimC input is too short. Paste your full addon export.');
      return;
    }
    setSubmitting(true);
    clearScenarioSiblings();
    try {
      const configs =
        scenarios.length > 0 ? scenarios : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = scenarios.length > 0 ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        simc_input: simcInput,
        iterations: 10000,
        target_error: 0.1,
        sim_type: 'quick',
        threads,
        ...(batchId ? { batch_id: batchId } : {}),
        ...(selectedTalent ? { talents: selectedTalent } : {}),
        ...(customApl ? { custom_apl: customApl } : {}),
        ...(simcHeader ? { simc_header: simcHeader } : {}),
        ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
        ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
        ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
        ...(simcFooter ? { simc_footer: simcFooter } : {}),
      };

      const results = await Promise.allSettled(
        configs.map(async (config) => {
          const res = await fetch(`${API_URL}/api/sim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedPayload,
              fight_style: config.fightStyle,
              desired_targets: config.targetCount,
              max_time: config.fightLength,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || `Server error ${res.status}`);
          }
          return res.json();
        })
      );

      if (scenarios.length === 0) {
        const r = results[0];
        if (r.status === 'fulfilled') {
          window.location.href = `/sim/${r.value.id}`;
        } else {
          throw r.reason;
        }
      } else {
        const siblings = configs
          .map((config, i) => {
            const r = results[i];
            return r.status === 'fulfilled'
              ? {
                  id: r.value.id,
                  fightStyle: config.fightStyle,
                  targetCount: config.targetCount,
                  fightLength: config.fightLength,
                }
              : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        if (siblings.length > 0) {
          storeScenarioSiblings(siblings);
          clearScenarios();
          window.location.href = `/sim/${siblings[0].id}`;
        } else {
          throw new Error('All scenario submissions failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit sim');
    } finally {
      setSubmitting(false);
    }
  }

  const buttonLabel =
    scenarios.length > 0
      ? `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''}`
      : 'Run Simulation';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || simcInput.trim().length < 10}
        className="btn-primary w-full py-3 text-sm"
      >
        {submitting ? 'Running…' : buttonLabel}
      </button>
    </form>
  );
}
