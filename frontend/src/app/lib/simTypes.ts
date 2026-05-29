/**
 * Sim-mode presentation maps shared across the frontend.
 *
 * Wire values come from the backend `SimMode::as_wire`. Keep this in sync
 * with `backend/core/src/models.rs::SimMode`. Three History view components
 * used to inline their own copy of these maps, which silently dropped
 * Crest Upgrades / Enchant-Gem / Stat Weights entries.
 */

type Translator = (key: string, params?: Record<string, string | number>) => string;

const LABEL_KEYS: Record<string, string> = {
  quick: 'simType.quickSim',
  top_gear: 'simType.topGear',
  droptimizer: 'simType.dropFinder',
  upgrade_compare: 'simType.crestUpgrades',
  enchant_gem: 'simType.enchantGem',
  stat_weights: 'simType.statWeights',
};

const COLOR_CLASSES: Record<string, string> = {
  quick: 'bg-primary/10 text-primary border-primary/20',
  stat_weights: 'bg-primary/10 text-primary border-primary/20',
  top_gear: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  upgrade_compare: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  droptimizer: 'bg-secondary/10 text-secondary border-secondary/20',
  enchant_gem: 'bg-secondary/10 text-secondary border-secondary/20',
};

const DEFAULT_COLOR =
  'border-outline-variant/10 bg-surface-container-highest text-on-surface-variant';

export function getSimTypeLabel(simType: string, t: Translator): string {
  const key = LABEL_KEYS[simType];
  return key ? t(key) : simType;
}

export function getSimTypeColorClass(simType: string): string {
  return COLOR_CLASSES[simType] ?? DEFAULT_COLOR;
}

/** Sim modes that render via the gear-comparison result shape (rows of
 *  combos ranked vs a base). Mirrors `SimMode::result_kind() == GearComparison`
 *  in `backend/core/src/models.rs`. Used as a legacy fallback for results
 *  persisted before `result_kind` started shipping in the payload. */
export const GEAR_COMPARISON_SIM_TYPES = [
  'top_gear',
  'enchant_gem',
  'droptimizer',
  'upgrade_compare',
] as const;
