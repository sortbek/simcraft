'use client';

import { useCallback, useRef, useState } from 'react';
import type { MdtConversion } from '../../lib/api';
import { saveRoute, type SavedRoute } from '../../lib/saved-routes';
import { useLanguage } from '../../lib/i18n';
import { T } from './routeTheme';
import RouteHeader from './RouteHeader';
import RouteMap from './RouteMap';
import ForcesTimeline from './ForcesTimeline';
import { SaveModal, Toast } from './RouteOverlays';
import { useRouteEditor } from './useRouteEditor';

export default function RouteViewer({
  conv,
  mdtString,
  onImport,
  siblings,
  currentRouteId,
  onSwitch,
  onBack,
}: {
  conv: MdtConversion;
  mdtString: string;
  onImport: () => void;
  /** Saved routes in this dungeon, for the header's in-place switcher. */
  siblings?: SavedRoute[];
  currentRouteId?: string | null;
  onSwitch?: (route: SavedRoute) => void;
  /** Return to the routes library. */
  onBack?: () => void;
}) {
  const { t } = useLanguage();
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const editor = useRouteEditor(conv, flash);

  const doSave = async (name: string) => {
    setModal(false);
    try {
      // An unedited MDT import is saved as its string alone, so it stays an "MDT"
      // route and re-sims through decode (preserving the drawn-line travel delays
      // and title the string carries). Once the pull assignment is edited — or the
      // route was built from a dungeon overview (no string) — save it level-
      // agnostically as dungeon + pull clone-refs; the SimC is then regenerated at
      // the chosen keystone level on load.
      const dirty = editor.assignment.some((p, i) => p !== conv.map.enemies[i].pull);
      const isUneditedMdt = mdtString.trim().startsWith('!') && !dirty;
      if (isUneditedMdt) {
        await saveRoute(name, { mdtString, dungeonIdx: conv.map.dungeon_idx });
      } else {
        const pulls = editor.pulls.map((p) =>
          p.cloneIdxs.map((i) => {
            const e = conv.map.enemies[i];
            return { enemy_idx: e.enemy_idx, clone_idx: e.clone_idx };
          })
        );
        await saveRoute(name, {
          mdtString,
          dungeonIdx: conv.map.dungeon_idx,
          pulls: JSON.stringify(pulls),
        });
      }
      flash(t('route.toast.saved', { name }));
    } catch (e) {
      flash(t('route.toast.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: T.bg,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${T.border}`,
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
    >
      <RouteHeader
        dungeonName={conv.dungeon_name}
        keystoneLevel={conv.keystone_level}
        pullCount={editor.pulls.length}
        enemyCount={editor.enemyCount}
        mdtVersion={conv.mdt_version}
        mode={editor.mode}
        onToggleMode={editor.toggleMode}
        onImport={onImport}
        onSave={() => setModal(true)}
        onBack={onBack}
        routes={siblings}
        currentRouteId={currentRouteId}
        onSwitch={onSwitch}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', padding: 16, minWidth: 0 }}>
          <RouteMap editor={editor} map={conv.map} />
        </div>
        <ForcesTimeline
          pulls={editor.pulls}
          enemyCount={editor.enemyCount}
          coveragePct={editor.coveragePct}
          selected={editor.selected}
          pick={editor.pick}
          onSelect={editor.onPullClick}
        />
      </div>

      {modal && (
        <SaveModal
          dungeonName={conv.dungeon_name}
          keystoneLevel={conv.keystone_level}
          pullCount={editor.pulls.length}
          enemyCount={editor.enemyCount}
          onClose={() => setModal(false)}
          onSave={doSave}
        />
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );
}
