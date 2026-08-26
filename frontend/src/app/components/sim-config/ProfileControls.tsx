'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import {
  createProfile,
  decodeProfileString,
  deleteProfile,
  encodeProfileString,
  isDefaultProfile,
  updateProfile,
  type ProfileDecodeError,
} from '../../lib/sim-profiles';

const BTN =
  'shrink-0 rounded-lg px-3 py-2 text-[12px] font-bold uppercase tracking-wider transition-colors text-on-surface-variant/50 hover:bg-surface-container-high/50 hover:text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** A newer-schema paste is a different problem from a corrupt one: telling the
 *  user it's invalid makes them retry the paste instead of updating SimHammer. */
const IMPORT_ERROR_KEY: Record<ProfileDecodeError, string> = {
  invalid: 'profiles.importInvalid',
  unsupported: 'profiles.versionUnsupported',
  tooLarge: 'profiles.importTooLarge',
};

/** Drawer-header profile management: save / save-as / rename / delete /
 *  export / import. The picker (footer) only applies. */
export default function ProfileControls() {
  const { t } = useLanguage();
  const {
    activeProfile,
    setActiveProfile,
    applyProfile,
    captureProfileData,
    saveActiveProfile,
    profileDirty,
  } = useSimContext();
  const [mode, setMode] = useState<'idle' | 'saveAs' | 'rename' | 'import'>('idle');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref, not `busy`: two clicks can both land before React re-renders with the
  // button disabled, which is exactly how a double-click made two profile rows.
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  // The built-in Default is not a stored row: nothing to save over, rename, or
  // delete. "Save as" is the way out of it.
  const isBuiltin = !!activeProfile && isDefaultProfile(activeProfile);

  const run = (start: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    setBusy(true);
    start()
      .catch((e) => setError(e instanceof Error ? e.message : t('profiles.saveFailed')))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  const onSave = () => run(() => saveActiveProfile());

  const onConfirmName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === 'saveAs') {
      run(() => createProfile(trimmed, captureProfileData()).then(setActiveProfile));
    } else if (mode === 'rename' && activeProfile) {
      run(() => updateProfile({ ...activeProfile, name: trimmed }).then(setActiveProfile));
    } else if (mode === 'import') {
      run(() =>
        decodeProfileString(trimmed).then((res) => {
          if (!res.ok) throw new Error(t(IMPORT_ERROR_KEY[res.error]));
          return createProfile(res.name, res.data).then(applyProfile);
        })
      );
    }
    setMode('idle');
    setName('');
  };

  const onDelete = () => {
    if (!activeProfile || isBuiltin) return;
    if (!window.confirm(t('profiles.deleteConfirm'))) return;
    run(() => deleteProfile(activeProfile.id).then(() => setActiveProfile(null)));
  };

  const onExport = () => {
    if (!activeProfile) return;
    run(() =>
      // Export what's on screen, not the last-saved data: exporting with the
      // dirty dot lit would otherwise ship the pre-edit config with no warning.
      encodeProfileString({ ...activeProfile, data: captureProfileData() })
        .then((s) => navigator.clipboard.writeText(s))
        .then(() => {
          setCopied(true);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopied(false), 1500);
        })
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {error && <span className="mr-2 text-xs text-red-400">{error}</span>}
      {mode === 'idle' ? (
        <>
          <button
            type="button"
            className={BTN}
            disabled={!activeProfile || isBuiltin || !profileDirty || busy}
            onClick={onSave}
          >
            {t('profiles.save')}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() => {
              setMode('saveAs');
              setName('');
            }}
          >
            {t('profiles.saveAs')}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!activeProfile || isBuiltin || busy}
            onClick={() => {
              setMode('rename');
              setName(activeProfile?.name ?? '');
            }}
          >
            {t('profiles.rename')}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!activeProfile || isBuiltin || busy}
            onClick={onDelete}
          >
            {t('profiles.delete')}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!activeProfile || busy}
            onClick={onExport}
          >
            {copied ? t('profiles.copied') : t('profiles.export')}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() => {
              setMode('import');
              setName('');
            }}
          >
            {t('profiles.import')}
          </button>
        </>
      ) : (
        <>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmName();
              if (e.key === 'Escape') {
                setMode('idle');
                setName('');
              }
            }}
            placeholder={
              mode === 'import' ? t('profiles.importPlaceholder') : t('profiles.namePlaceholder')
            }
            className={`input-field !py-1.5 ${mode === 'import' ? 'w-64' : 'w-44'}`}
          />
          <button
            type="button"
            className={BTN}
            disabled={!name.trim() || busy}
            onClick={onConfirmName}
          >
            {t(
              mode === 'saveAs'
                ? 'profiles.saveAs'
                : mode === 'rename'
                  ? 'profiles.rename'
                  : 'profiles.import'
            )}
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setMode('idle');
              setName('');
            }}
          >
            {t('common.close')}
          </button>
        </>
      )}
    </div>
  );
}
