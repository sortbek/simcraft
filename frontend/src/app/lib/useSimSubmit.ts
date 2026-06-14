import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../components/sim-config/SimContext';
import { API_URL, providerKeyHeaders } from './api';
import { useLanguage } from './i18n';
import type { FightScenario } from './types';
import { storeScenarioSiblings, clearScenarioSiblings } from './scenario-siblings';
import { useSharedSimPayload } from './useSharedSimPayload';
import { materializeRoute } from './active-route';

interface UseSimSubmitOptions {
  /** API endpoint path, e.g. "/api/sim" */
  endpoint: string;
  /**
   * Build per-page payload fields (merged into the shared payload).
   * Return null to abort submission.
   */
  buildPayload: () => Record<string, unknown> | null;
  /** Optional pre-submit validation. Return an error string to abort. */
  validate?: () => string | null;
  /** Called just before navigating to the result page. */
  onBeforeNavigate?: () => void;
}

export function useSimSubmit({
  endpoint,
  buildPayload,
  validate,
  onBeforeNavigate,
}: UseSimSubmitOptions) {
  const { t } = useLanguage();
  const router = useRouter();
  const {
    fightStyle,
    targetCount,
    fightLength,
    scenarios,
    clearScenarios,
    activeRoute,
    isDungeonRoute,
  } = useSimContext();

  const sharedSimPayload = useSharedSimPayload();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    setError('');

    if (validate) {
      const err = validate();
      if (err) {
        setError(err);
        return;
      }
    }

    // No pre-submit warning. The backend queues local sims (see
    // LocalSimcProvider) and Simmit handles its own queue, so simultaneous
    // submits can't actually fight for resources. While a sim waits in the
    // local queue the SimStatus screen surfaces "Queued · waiting for active
    // local sim to finish" via the standard progress channel.

    const pagePayload = buildPayload();
    if (pagePayload === null) return;

    setSubmitting(true);
    clearScenarioSiblings();

    try {
      // Scenarios sweep fight styles, but Dungeon Route mode forces
      // fight_style=DungeonRoute and a loaded route is applied to every run — either
      // would silently run the same thing N times. Ignore queued scenarios in both
      // cases (the scenario builder is hidden in the same cases).
      const useScenarios = scenarios.length > 0 && !activeRoute && !isDungeonRoute;
      const configs: FightScenario[] = useScenarios
        ? scenarios
        : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = useScenarios ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        ...pagePayload,
        ...sharedSimPayload,
        ...(batchId ? { batch_id: batchId } : {}),
      };

      // Materialize the active dungeon route to SimC at sim time, applying the
      // currently-chosen keystone level + HP share, and prepend it to custom_apl
      // (its `fight_style=DungeonRoute` line is what the backend detects). Held as
      // data until now so one route sims at any level without re-importing.
      if (activeRoute) {
        const routeSimc = await materializeRoute(activeRoute);
        const payload = sharedPayload as Record<string, unknown>;
        const existing = payload.custom_apl as string | undefined;
        payload.custom_apl = existing ? `${routeSimc}\n${existing}` : routeSimc;
      }

      const computeChoice = (sharedPayload as { compute_provider?: string }).compute_provider;
      const results = await Promise.allSettled(
        configs.map(async (config) => {
          const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...providerKeyHeaders(computeChoice),
            },
            body: JSON.stringify({
              ...sharedPayload,
              fight_style: config.fightStyle,
              desired_targets: config.targetCount,
              max_time: config.fightLength,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || t('validation.serverError', { status: res.status }));
          }
          return res.json();
        })
      );

      if (!useScenarios) {
        const r = results[0];
        if (r.status === 'fulfilled') {
          onBeforeNavigate?.();
          router.push(`/sim/${r.value.id}`);
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
          onBeforeNavigate?.();
          router.push(`/sim/${siblings[0].id}`);
        } else {
          throw new Error(t('validation.allScenariosFailed'));
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('validation.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [
    endpoint,
    buildPayload,
    validate,
    onBeforeNavigate,
    router,
    fightStyle,
    targetCount,
    fightLength,
    sharedSimPayload,
    scenarios,
    clearScenarios,
    activeRoute,
    isDungeonRoute,
    t,
  ]);

  const buttonLabel = useCallback(
    (defaultLabel: string) =>
      scenarios.length > 0
        ? scenarios.length > 1
          ? t('button.runScenarios', { count: scenarios.length })
          : t('button.runScenario', { count: scenarios.length })
        : defaultLabel,
    [scenarios.length, t]
  );

  return { submit, submitting, error, setError, buttonLabel };
}
