'use client';

import { useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import {
  createProfile,
  deleteProfile,
  exportProfileJson,
  parseProfileExport,
  updateProfile,
} from '../../lib/sim-profiles';

const BTN =
  'rounded-lg px-3 py-2 text-[12px] font-bold uppercase tracking-wider transition-colors text-on-surface-variant/50 hover:bg-surface-container-high/50 hover:text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** Drawer-header profile management: save / save-as / rename / delete /
 *  export / import. The picker (footer) only applies. */
export default function ProfileControls() {
  const { t } = useLanguage();
  const {
    activeProfile,
    setActiveProfile,
    applyProfile,
    captureProfileData,
    profileDirty,
    routeOwnsFight,
  } = useSimContext();
  const [mode, setMode] = useState<'idle' | 'saveAs' | 'rename'>('idle');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (p: Promise<unknown>) => {
    setError('');
    p.catch((e) => setError(e instanceof Error ? e.message : t('profiles.saveFailed')));
  };

  const onSave = () => {
    if (!activeProfile) return;
    const current = captureProfileData();
    // Mirror the dirty mask: a route's forced fightStyle / cleared scenarios
    // must not overwrite the profile's own.
    const data = routeOwnsFight
      ? {
          ...current,
          fightStyle: activeProfile.data.fightStyle,
          scenarios: activeProfile.data.scenarios,
        }
      : current;
    run(updateProfile({ ...activeProfile, data }).then(setActiveProfile));
  };

  const onConfirmName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === 'saveAs') {
      run(createProfile(trimmed, captureProfileData()).then(setActiveProfile));
    } else if (mode === 'rename' && activeProfile) {
      run(updateProfile({ ...activeProfile, name: trimmed }).then(setActiveProfile));
    }
    setMode('idle');
    setName('');
  };

  const onDelete = () => {
    if (!activeProfile) return;
    if (!window.confirm(t('profiles.deleteConfirm'))) return;
    run(deleteProfile(activeProfile.id).then(() => setActiveProfile(null)));
  };

  const onExport = () => {
    if (!activeProfile) return;
    const url = URL.createObjectURL(
      new Blob([exportProfileJson(activeProfile)], { type: 'application/json' })
    );
    const a = document.createElement('a');
    a.href = url;
    // Strip only filesystem-illegal characters — names are localized.
    const safeName = activeProfile.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'profile';
    a.download = `${safeName}.json`;
    a.click();
    // Deferred: revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onImportFile = async (file: File) => {
    setError('');
    const parsed = parseProfileExport(await file.text());
    if (!parsed) {
      setError(t('profiles.importInvalid'));
      return;
    }
    run(createProfile(parsed.name, parsed.data).then(applyProfile));
  };

  return (
    <div className="flex items-center gap-1">
      {error && <span className="mr-2 text-xs text-red-400">{error}</span>}
      {mode === 'idle' ? (
        <>
          <button
            type="button"
            className={BTN}
            disabled={!activeProfile || !profileDirty}
            onClick={onSave}
          >
            {t('profiles.save')}
          </button>
          <button
            type="button"
            className={BTN}
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
            disabled={!activeProfile}
            onClick={() => {
              setMode('rename');
              setName(activeProfile?.name ?? '');
            }}
          >
            {t('profiles.rename')}
          </button>
          <button type="button" className={BTN} disabled={!activeProfile} onClick={onDelete}>
            {t('profiles.delete')}
          </button>
          <button type="button" className={BTN} disabled={!activeProfile} onClick={onExport}>
            {t('profiles.export')}
          </button>
          <button type="button" className={BTN} onClick={() => fileRef.current?.click()}>
            {t('profiles.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImportFile(f);
            }}
          />
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
            placeholder={t('profiles.namePlaceholder')}
            className="w-44 rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 py-1.5 text-sm text-on-surface outline-none focus:border-primary"
          />
          <button type="button" className={BTN} disabled={!name.trim()} onClick={onConfirmName}>
            {mode === 'saveAs' ? t('profiles.saveAs') : t('profiles.rename')}
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
