import { useMemo } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { decodeHeader } from './talentDecode';
import { SPEC_ID_TO_NAME } from './types';

/**
 * Single source of truth for the SimContext-derived options that both the real
 * submit (see {@link useSimSubmit}) and the cloud-estimate preflight must send,
 * so the backend's `req.options` (a flattened `SimOptions`) is populated
 * identically in both paths.
 *
 * Returns everything `sharedPayload` in useSimSubmit adds on top of the page
 * payload, EXCLUDING the submit-only `batch_id` (estimates are never batched)
 * and the per-config fight scenario fields (`fight_style` / `desired_targets` /
 * `max_time`), which submit adds per-scenario and the estimate adds from the
 * SimContext base fight params.
 */
export function useSharedSimPayload(): Record<string, unknown> {
  const {
    threads,
    selectedTalent,
    targetError,
    iterations,
    customApl,
    rotationMode,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    raidBuffs,
    consumables,
    expansionOptions,
    simcBranch,
    parallelProfilesets,
    triageMaxBatchProfilesets,
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

  return useMemo(
    () => ({
      iterations,
      target_error: targetError,
      threads,
      ...(selectedTalent ? { talents: selectedTalent } : {}),
      ...(specOverride ? { spec_override: specOverride } : {}),
      ...(customApl ? { custom_apl: customApl } : {}),
      ...(rotationMode !== 'default' ? { rotation_mode: rotationMode } : {}),
      ...(simcHeader ? { simc_header: simcHeader } : {}),
      ...(simcBasePlayer ? { simc_base_player: simcBasePlayer } : {}),
      ...(simcRaidActors ? { simc_raid_actors: simcRaidActors } : {}),
      ...(simcPostCombos ? { simc_post_combos: simcPostCombos } : {}),
      ...(simcFooter ? { simc_footer: simcFooter } : {}),
      ...(parallelProfilesets ? {} : { parallel_profilesets: false }),
      triage_max_batch_profilesets: triageMaxBatchProfilesets,
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
    }),
    [
      threads,
      selectedTalent,
      targetError,
      iterations,
      customApl,
      rotationMode,
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
      parallelProfilesets,
      triageMaxBatchProfilesets,
    ]
  );
}
