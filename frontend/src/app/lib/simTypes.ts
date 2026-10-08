/**
 * Sim-mode presentation maps shared across the frontend. Wire values come from
 * the backend `SimMode::as_wire`; keep in sync with
 * `backend/core/src/models.rs::SimMode`. Centralized because inlined copies in
 * History views silently dropped Crest Upgrades / Enchant-Gem / Stat Weights.
 */

type Translator = (key: string, params?: Record<string, string | number>) => string;

const LABEL_KEYS: Record<string, string> = {
  quick: 'simType.quickSim',
  top_gear: 'simType.topGear',
  droptimizer: 'simType.dropFinder',
  upgrade_compare: 'simType.crestUpgrades',
  stat_weights: 'simType.statWeights',
};

export function getSimTypeLabel(simType: string, t: Translator): string {
  const key = LABEL_KEYS[simType];
  return key ? t(key) : simType;
}

/** Sim modes rendering via the gear-comparison result shape (combos ranked vs a
 *  base). Mirrors `SimMode::result_kind() == GearComparison` in
 *  `backend/core/src/models.rs`. Legacy fallback for results persisted before
 *  `result_kind` shipped in the payload. */
export const GEAR_COMPARISON_SIM_TYPES = ['top_gear', 'droptimizer', 'upgrade_compare'] as const;
