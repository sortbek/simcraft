import { ROUTES } from '../routes';
import { readSessionJson, readStoredJson, readStoredString } from '../storage';
import { normalizeProfileData, type SimProfile, type SimProfileData } from '../sim-profiles';
import type { TopGearSavedState } from '../topgear-state';

/** Sim page each shared mode opens in. */
export const EDIT_ROUTES: Record<string, string> = {
  quick: ROUTES.quickSim,
  stat_weights: ROUTES.quickSim,
  top_gear: ROUTES.topGear,
  droptimizer: ROUTES.dropFinder,
  upgrade_compare: ROUTES.upgradeCompare,
};

type Req = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// The wire sends buff/option overrides as 0/1 and only when one is off.
function flags(v: unknown): Record<string, boolean> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  return Object.fromEntries(Object.entries(v as Req).map(([k, on]) => [k, !!on]));
}

/** The sharer's sim settings over the viewer's own. Machine-local choices
 *  (threads, SimC branch, batching) stay the viewer's. */
export function sharedConfig(request: Req, mode: string, own: SimProfileData): SimProfileData {
  return normalizeProfileData({
    ...own,
    fightStyle: text(request.fight_style),
    fightLength: num(request.max_time),
    targetCount: num(request.desired_targets),
    scenarios: [],
    iterations: num(request.iterations),
    targetError: num(request.target_error),
    rotationMode: request.rotation_mode,
    customApl: text(request.custom_apl) ?? '',
    raidBuffs: flags(request.raid_buffs) ?? {},
    consumables: request.consumables ?? {},
    expansionOptions: flags(request.expansion_options) ?? {},
    simcHeader: text(request.simc_header) ?? '',
    simcBasePlayer: text(request.simc_base_player) ?? '',
    simcRaidActors: text(request.simc_raid_actors) ?? '',
    simcPostCombos: text(request.simc_post_combos) ?? '',
    simcFooter: text(request.simc_footer) ?? '',
    statWeights: mode === 'stat_weights' || request.sim_type === 'stat_weights',
  });
}

/** Makes the sharer's chosen loadout the active `talents=` line, which is the
 *  one the talent picker selects for an imported character. */
export function withActiveTalents(simcInput: string, talents: unknown): string {
  if (typeof talents !== 'string' || !talents || /[\r\n]/.test(talents)) return simcInput;
  return /^talents=.*$/m.test(simcInput)
    ? simcInput.replace(/^talents=.*$/m, () => `talents=${talents}`)
    : `${simcInput}\ntalents=${talents}`;
}

function idLists(v: unknown): Record<string, number[]> {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(
    Object.entries(v as Req).map(([k, ids]) => [
      k,
      Array.isArray(ids) ? ids.filter((n): n is number => typeof n === 'number') : [],
    ])
  );
}

/** Top Gear's selection as its own saved state. Items the sharer added are
 *  already `# slot=` lines in `simc_input`, so they resolve as alternatives. */
export function topGearStateFromRequest(request: Req): TopGearSavedState {
  const selected: Record<string, string[]> = {};
  for (const [slot, uids] of Object.entries((request.selected_items ?? {}) as Req)) {
    if (Array.isArray(uids))
      selected[slot] = uids.filter((u): u is string => typeof u === 'string');
  }
  const replacements = request.equipped_replacements;
  return {
    selectedUids: selected,
    excludedEquipped:
      replacements && typeof replacements === 'object' ? Object.keys(replacements) : [],
    localItems: [],
    enchantSelections: idLists(request.enchant_selections),
    gemSelections: Array.isArray(request.gem_options)
      ? request.gem_options.filter((n): n is number => typeof n === 'number')
      : [],
    maxUpgrade: request.max_upgrade === true,
    copyEnchants: request.copy_enchants === true,
    catalyst: request.catalyst === true,
    catalystCharges: num(request.catalyst_charges) ?? null,
    replaceGems: request.replace_gems === true,
    diamondAlwaysUse: request.diamond_always_use === true,
    maxColors: request.max_colors === true,
  };
}

/** The viewer's own setup, put back by "Restore my setup". */
export interface OwnSetup {
  config: SimProfileData;
  activeProfile: SimProfile | null;
  simcInput: string;
  /** Page state the load overwrites: Top Gear's saved selection, Drop Finder's raw prefs. */
  topGear?: TopGearSavedState | null;
  dropFinderPrefs?: string | null;
}

export interface SharedEdit {
  shareId: string;
  playerName: string;
  own: OwnSetup;
}

const EDIT_KEY = 'simhammer_shared_edit';
const PAGE_KEY = 'simhammer_shared_edit_page';
const ADOPTED_KEY = 'simhammer_shared_setup_adopted';
const listeners = new Set<() => void>();
const restoreListeners = new Set<() => void>();

/** Storage can refuse (private mode, full quota); losing this state beats a crash. */
function safely(write: () => void): void {
  try {
    write();
  } catch {}
}

/** Set or (with `null`) remove a raw `localStorage` string. */
export function writeStoredString(key: string, value: string | null): void {
  safely(() => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)));
}

export function readSharedEdit(): SharedEdit | null {
  return readStoredJson<SharedEdit | null>(EDIT_KEY, null);
}

/** The stored edit as raw text: cheap to compare, for change detection. */
export function readSharedEditRaw(): string | null {
  return readStoredString(EDIT_KEY);
}

export function writeSharedEdit(edit: SharedEdit | null): void {
  writeStoredString(EDIT_KEY, edit ? JSON.stringify(edit) : null);
  listeners.forEach((l) => l());
}

/** "Keep this setup" made a share's SimC text the viewer's own; its sims still
 *  get the backend's final input check until "Restore my setup". */
export function markSharedSetupAdopted(adopted: boolean): void {
  writeStoredString(ADOPTED_KEY, adopted ? '1' : null);
}

/** Whether sims should carry `untrusted`: a share is loaded, or one was kept. */
export function simsFromSharedSetup(): boolean {
  return readSharedEditRaw() !== null || readStoredString(ADOPTED_KEY) === '1';
}

export function subscribeSharedEdit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fired after "Restore my setup", so mounted pages re-read their saved state. */
export function onSetupRestored(listener: () => void): () => void {
  restoreListeners.add(listener);
  return () => restoreListeners.delete(listener);
}

export function notifySetupRestored(): void {
  restoreListeners.forEach((l) => l());
}

/** Page-specific part of a shared request, waiting for its page to mount. */
export function stashPageEdit(mode: string, request: Req): void {
  safely(() => sessionStorage.setItem(PAGE_KEY, JSON.stringify({ mode, request })));
}

export function peekPageEdit(modes: string[]): Req | null {
  const pending = readSessionJson<{ mode?: unknown; request?: Req } | null>(PAGE_KEY, null);
  return pending && typeof pending.mode === 'string' && modes.includes(pending.mode)
    ? (pending.request ?? null)
    : null;
}

export function clearPageEdit(): void {
  safely(() => sessionStorage.removeItem(PAGE_KEY));
}
