import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../components/sim-config/SimContext';
import { API_URL } from './api';
import { useLanguage } from './i18n';
import { decodeHeader } from './talentDecode';
import { SPEC_ID_TO_NAME } from './types';
import type { FightScenario } from './types';
import { storeScenarioSiblings, clearScenarioSiblings } from './scenario-siblings';

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
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    targetError,
    customApl,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    raidBuffs,
    consumables,
    expansionOptions,
    simcBranch,
    scenarios,
    clearScenarios,
  } = useSimContext();

  // Derive spec from selected talent string so the backend can override spec= in the SimC input
  const specOverride = useMemo(() => {
    if (!selectedTalent) return '';
    try {
      const { specId } = decodeHeader(selectedTalent);
      return SPEC_ID_TO_NAME[specId] ?? '';
    } catch {
      return '';
    }
  }, [selectedTalent]);

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

    const pagePayload = buildPayload();
    if (pagePayload === null) return;

    setSubmitting(true);
    clearScenarioSiblings();

    try {
      const configs: FightScenario[] =
        scenarios.length > 0 ? scenarios : [{ id: '', fightStyle, targetCount, fightLength }];

      const batchId = scenarios.length > 0 ? crypto.randomUUID() : undefined;

      const sharedPayload = {
        ...pagePayload,
        iterations: 100000,
        target_error: targetError,
        threads,
        ...(batchId ? { batch_id: batchId } : {}),
        ...(selectedTalent ? { talents: selectedTalent } : {}),
        ...(specOverride ? { spec_override: specOverride } : {}),
        ...(customApl ? { custom_apl: customApl } : {}),
        ...(simcHeader ? { simc_header: simcHeader } : {}),
        ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
        ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
        ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
        ...(simcFooter ? { simc_footer: simcFooter } : {}),
        // Raid buffs: only send overrides for disabled buffs
        ...(Object.values(raidBuffs).some((v) => !v)
          ? {
              raid_buffs: Object.fromEntries(
                Object.entries(raidBuffs).map(([k, v]) => [k, v ? 1 : 0])
              ),
            }
          : {}),
        // Consumables: only send non-empty selections
        ...(Object.values(consumables).some((v) => v)
          ? { consumables: Object.fromEntries(Object.entries(consumables).filter(([, v]) => v)) }
          : {}),
        // Expansion options: only send overrides for disabled options
        ...(Object.values(expansionOptions).some((v) => !v)
          ? {
              expansion_options: Object.fromEntries(
                Object.entries(expansionOptions).map(([k, v]) => [k, v ? 1 : 0])
              ),
            }
          : {}),
        ...(simcBranch ? { simc_branch: simcBranch } : {}),
      };

      const results = await Promise.allSettled(
        configs.map(async (config) => {
          const res = await fetch(`${API_URL}${endpoint}`, {
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
            throw new Error(data.detail || t('validation.serverError', { status: res.status }));
          }
          return res.json();
        })
      );

      if (scenarios.length === 0) {
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
    threads,
    selectedTalent,
    targetCount,
    fightLength,
    targetError,
    customApl,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    raidBuffs,
    consumables,
    expansionOptions,
    simcBranch,
    specOverride,
    scenarios,
    clearScenarios,
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
