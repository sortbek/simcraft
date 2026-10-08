import { useMemo } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { primaryOmniumOverride } from '../components/omnium/omniumSelection';
import { decodeHeader } from './talentDecode';
import { SPEC_ID_TO_NAME } from './types';
import { DEFAULT_RAID_BUFFS } from './sim-config-defaults';
import { useOmniumTree } from './useOmniumTree';

/** The spec a talent string belongs to, so the backend can override `spec=`
 *  when a build of another spec is selected. Empty when it can't be decoded. */
export function specOverrideOf(talentString: string): string {
  if (!talentString) return '';
  try {
    return SPEC_ID_TO_NAME[decodeHeader(talentString).specId] ?? '';
  } catch {
    return '';
  }
}

/**
 * Single source of truth for SimContext-derived options shared by the real
 * submit ({@link useSimSubmit}) and the cloud-estimate preflight, so the
 * backend's flattened `req.options` is populated identically in both paths.
 *
 * Excludes the submit-only `batch_id` (estimates are never batched) and the
 * per-config fight scenario fields (`fight_style`/`desired_targets`/`max_time`),
 * which submit adds per-scenario and the estimate adds from SimContext base params.
 */
export function useSharedSimPayload(): Record<string, unknown> {
  const {
    simcInput,
    folioSelections,
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

  // The folio the user picked, sent only when it differs from the imported one
  // so an untouched profile reaches SimC exactly as it did before.
  const omniumTree = useOmniumTree();
  const omniumOverride = useMemo(
    () => (omniumTree ? primaryOmniumOverride(omniumTree, folioSelections, simcInput) : ''),
    [omniumTree, folioSelections, simcInput]
  );

  const specOverride = useMemo(() => specOverrideOf(selectedTalent), [selectedTalent]);

  return useMemo(
    () => ({
      iterations,
      target_error: targetError,
      threads,
      ...(selectedTalent ? { talents: selectedTalent } : {}),
      ...(omniumOverride ? { omnium_talents: omniumOverride } : {}),
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
      // Raid buffs: sent only when they differ from the defaults
      ...(Object.entries(raidBuffs).some(([k, v]) => v !== (DEFAULT_RAID_BUFFS[k] ?? true))
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
      omniumOverride,
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
