import { useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../../components/sim-config/SimContext';
import { postJson } from '../api';
import { clearTopGearState, getTopGearState, storeTopGearState } from '../topgear-state';
import { DROP_FINDER_PREFS_KEY } from '../../components/loot/dropFinderPrefs';
import type { SharePayload } from './api';
import { ownEntry } from './rerun';
import {
  EDIT_ROUTES,
  clearPageEdit,
  markSharedSetupAdopted,
  notifySetupRestored,
  readSharedEdit,
  readSharedEditRaw,
  sharedConfig,
  stashPageEdit,
  subscribeSharedEdit,
  topGearStateFromRequest,
  withActiveTalents,
  writeSharedEdit,
  writeStoredString,
  type SharedEdit,
} from './editShared';
import { readStoredString } from '../storage';

let cachedRaw: string | null = null;
let cached: SharedEdit | null = null;
function snapshot(): SharedEdit | null {
  // useSyncExternalStore needs a stable value between changes; the raw string
  // is compared, so an unchanged edit is never re-parsed.
  const raw = readSharedEditRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readSharedEdit();
  }
  return cached;
}

/** Load a shared sim into its editor page, and put the viewer's own setup back. */
export function useEditShared() {
  const router = useRouter();
  const {
    simcInput,
    activeProfile,
    captureProfileData,
    applyConfig,
    setActiveProfile,
    setSimcInput,
  } = useSimContext();
  const active = useSyncExternalStore(subscribeSharedEdit, snapshot, () => null);

  const edit = useCallback(
    async (payload: SharePayload, shareId: string) => {
      const route = ownEntry(EDIT_ROUTES, payload.mode);
      if (!payload.request || !route) return;
      // Submitted later as an ordinary sim, so strip what the re-run path would.
      const request = await postJson<Record<string, unknown>>(
        '/api/share/sanitize',
        payload.request
      );
      const own = captureProfileData();
      // Loading a second share keeps the setup from before the first.
      writeSharedEdit({
        shareId,
        playerName: payload.result.player_name,
        own: readSharedEdit()?.own ?? {
          config: own,
          activeProfile,
          simcInput,
          topGear: getTopGearState(),
          dropFinderPrefs: readStoredString(DROP_FINDER_PREFS_KEY),
        },
      });
      applyConfig(sharedConfig(request, payload.mode, own));
      setActiveProfile(null);
      const input = typeof request.simc_input === 'string' ? request.simc_input : '';
      setSimcInput(withActiveTalents(input, request.talents));
      if (payload.mode === 'top_gear') storeTopGearState(topGearStateFromRequest(request));
      else clearTopGearState();
      // Pages without their own saved state pick their part up on mount.
      if (payload.mode === 'droptimizer' || payload.mode === 'upgrade_compare')
        stashPageEdit(payload.mode, request);
      else clearPageEdit();
      router.push(route);
    },
    [
      router,
      simcInput,
      activeProfile,
      captureProfileData,
      applyConfig,
      setActiveProfile,
      setSimcInput,
    ]
  );

  const restore = useCallback(() => {
    const current = readSharedEdit();
    if (!current) return;
    applyConfig(current.own.config);
    setActiveProfile(current.own.activeProfile);
    setSimcInput(current.own.simcInput);
    if (current.own.topGear) storeTopGearState(current.own.topGear);
    else clearTopGearState();
    writeStoredString(DROP_FINDER_PREFS_KEY, current.own.dropFinderPrefs ?? null);
    clearPageEdit();
    markSharedSetupAdopted(false);
    writeSharedEdit(null);
    // Top Gear and Drop Finder read their saved state on mount only.
    notifySetupRestored();
  }, [applyConfig, setActiveProfile, setSimcInput]);

  const dismiss = useCallback(() => {
    clearPageEdit();
    markSharedSetupAdopted(true);
    writeSharedEdit(null);
  }, []);

  return { active, edit, restore, dismiss };
}
