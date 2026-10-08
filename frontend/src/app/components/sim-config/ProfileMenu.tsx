'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { useDismiss } from '../../lib/useDismiss';
import { buttonClass } from '../ui/Button';
import {
  createProfile,
  decodeProfileString,
  defaultProfile,
  deleteProfile,
  encodeProfileString,
  isDefaultProfile,
  isProfileSupported,
  listProfiles,
  updateProfile,
  type ProfileDecodeError,
  type SimProfile,
} from '../../lib/sim-profiles';

/** A newer-schema paste is a different problem from a corrupt one: telling the
 *  user it's invalid makes them retry the paste instead of updating SimHammer. */
const IMPORT_ERROR_KEY: Record<ProfileDecodeError, string> = {
  invalid: 'profiles.importInvalid',
  unsupported: 'profiles.versionUnsupported',
  tooLarge: 'profiles.importTooLarge',
};

export type ProfileMenuMode = 'list' | 'saveAs' | 'rename' | 'import';

/** Profile save/revert/manage actions, shared by the Sim settings header and
 *  the profile menu so both see one busy state. */
export function useProfileActions() {
  const { t } = useLanguage();
  const {
    activeProfile,
    setActiveProfile,
    applyProfile,
    captureProfileData,
    saveActiveProfile,
    profileDirty,
  } = useSimContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A ref, not `busy`: two clicks can both land before React re-renders with the
  // button disabled, which is exactly how a double-click made two profile rows.
  const inFlight = useRef(false);
  // Brief confirmation after a save; the block shows nothing while in sync.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );
  const confirmSaved = useCallback(() => {
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 2000);
  }, []);

  // The built-in Default is not a stored row: nothing to save over, rename, or
  // delete. "Save as" is the way out of it.
  const isBuiltin = !!activeProfile && isDefaultProfile(activeProfile);

  const run = useCallback(
    (start: () => Promise<unknown>, onDone?: () => void) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError('');
      setBusy(true);
      start()
        .then(() => onDone?.())
        .catch((e) => setError(e instanceof Error ? e.message : t('profiles.saveFailed')))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [t]
  );

  return {
    busy,
    error,
    isBuiltin,
    canSave: !!activeProfile && !isBuiltin && profileDirty && !busy,
    justSaved,
    save: () => run(() => saveActiveProfile(), confirmSaved),
    revert: () => activeProfile && applyProfile(activeProfile),
    saveAs: (name: string) =>
      run(() => createProfile(name, captureProfileData()).then(setActiveProfile), confirmSaved),
    rename: (name: string) =>
      activeProfile && run(() => updateProfile({ ...activeProfile, name }).then(setActiveProfile)),
    remove: () => {
      if (!activeProfile || isBuiltin) return;
      if (!window.confirm(t('profiles.deleteConfirm'))) return;
      run(() => deleteProfile(activeProfile.id).then(() => setActiveProfile(null)));
    },
    importString: (raw: string) =>
      run(() =>
        decodeProfileString(raw).then((res) => {
          if (!res.ok) throw new Error(t(IMPORT_ERROR_KEY[res.error]));
          return createProfile(res.name, res.data).then(applyProfile);
        })
      ),
    // Export what's on screen, not the last-saved data: exporting with unsaved
    // edits would otherwise ship the pre-edit config with no warning.
    exportString: (onCopied: () => void) =>
      activeProfile &&
      run(() =>
        encodeProfileString({ ...activeProfile, data: captureProfileData() })
          .then((s) => navigator.clipboard.writeText(s))
          .then(onCopied)
      ),
  };
}

export type ProfileActions = ReturnType<typeof useProfileActions>;

const CHECK = (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

const ITEM =
  'flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35';

/** Profile picker + management dropdown in the Sim settings header. `open` and
 *  `mode` are controlled so the header's "Save as new" can open the name form. */
export default function ProfileMenu({
  open,
  onOpenChange,
  mode,
  onModeChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ProfileMenuMode;
  onModeChange: (mode: ProfileMenuMode) => void;
  actions: ProfileActions;
}) {
  const { t } = useLanguage();
  const { activeProfile, applyProfile, profileDirty } = useSimContext();
  const [profiles, setProfiles] = useState<SimProfile[]>([]);
  // Distinct from an empty list: "no saved profiles yet" invites the user to
  // recreate profiles that a failed load only made invisible.
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismiss(rootRef, open, close);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    listProfiles().then(
      (list) => {
        setProfiles(list);
        setLoadFailed(false);
      },
      () => setLoadFailed(true)
    );
  }, [open, activeProfile]);

  useEffect(() => {
    if (open) setName(mode === 'rename' ? (activeProfile?.name ?? '') : '');
  }, [open, mode, activeProfile]);

  const displayName = activeProfile
    ? isDefaultProfile(activeProfile)
      ? t('profiles.default')
      : activeProfile.name
    : t('profiles.none');

  const pick = (p: SimProfile) => {
    applyProfile(p);
    close();
  };

  const confirmName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === 'saveAs') actions.saveAs(trimmed);
    else if (mode === 'rename') actions.rename(trimmed);
    else if (mode === 'import') actions.importString(trimmed);
    onModeChange('list');
    close();
  };

  const formTitle =
    mode === 'saveAs'
      ? t('profiles.saveAsNew')
      : mode === 'rename'
        ? t('profiles.rename')
        : t('profiles.importString');

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          onModeChange('list');
          onOpenChange(!open);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-[34px] max-w-full items-center gap-2 rounded-[7px] border bg-surface-container-high px-2.5 transition-colors ${
          open ? 'border-line/20' : 'border-line/[0.11] hover:border-line/20'
        }`}
      >
        <span className="lbl sim-settings-hide-sm !text-[9.5px]">{t('profiles.label')}</span>
        <span className="truncate font-headline text-[13px] font-extrabold text-on-surface">
          {displayName}
        </span>
        <svg
          className="h-3.5 w-3.5 shrink-0 text-outline"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="popover absolute left-0 top-full z-50 mt-1.5 w-[290px] max-w-[calc(100vw-32px)] p-1.5">
          {mode === 'list' ? (
            <>
              <div className="lbl px-2.5 pb-1.5 pt-1.5">{t('profiles.title')}</div>
              <button
                type="button"
                onClick={() => pick(defaultProfile())}
                className={`${ITEM} ${activeProfile && isDefaultProfile(activeProfile) ? 'bg-gold/[0.08] text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
              >
                <span className="w-3.5 text-gold">
                  {activeProfile && isDefaultProfile(activeProfile) && CHECK}
                </span>
                <span className="truncate">{t('profiles.default')}</span>
                <span className="ml-auto text-[11px] font-medium text-outline">
                  {t('profiles.builtin')}
                </span>
              </button>
              {loadFailed ? (
                <div className="px-2.5 py-2 text-xs text-negative">{t('profiles.loadFailed')}</div>
              ) : (
                profiles.length === 0 && (
                  <div className="px-2.5 py-2 text-xs text-on-surface-variant">
                    {t('profiles.empty')}
                  </div>
                )
              )}
              {profiles.map((p) => {
                // Newer-schema profiles are listed but not applicable. The title
                // lives on the wrapper: browsers suppress hover events (and thus
                // the tooltip) on a disabled button.
                const unsupported = !isProfileSupported(p);
                const active = activeProfile?.id === p.id;
                return (
                  <span
                    key={p.id}
                    className="block"
                    title={unsupported ? t('profiles.versionUnsupported') : undefined}
                  >
                    <button
                      type="button"
                      disabled={unsupported}
                      onClick={() => pick(p)}
                      className={`${ITEM} ${active ? 'bg-gold/[0.08] text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
                    >
                      <span className="w-3.5 text-gold">{active && CHECK}</span>
                      <span className="truncate">{p.name}</span>
                      {active && profileDirty && (
                        <span className="ml-auto rounded-[4px] bg-gold/10 px-1.5 py-0.5 font-headline text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-gold">
                          {t('profiles.edited')}
                        </span>
                      )}
                    </button>
                  </span>
                );
              })}

              <div className="mx-1 my-1.5 h-px bg-overlay/[0.06]" />
              <button
                type="button"
                disabled={!actions.canSave}
                onClick={() => {
                  actions.save();
                  close();
                }}
                className={`${ITEM} text-gold hover:bg-surface-container-highest`}
              >
                {activeProfile ? t('profiles.saveTo', { name: displayName }) : t('profiles.save')}
              </button>
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => onModeChange('saveAs')}
                className={`${ITEM} text-on-surface-variant hover:bg-surface-container-highest`}
              >
                {t('profiles.saveAsNew')}
              </button>
              <button
                type="button"
                disabled={!profileDirty}
                onClick={() => {
                  actions.revert();
                  close();
                }}
                className={`${ITEM} text-on-surface-variant hover:bg-surface-container-highest`}
              >
                {t('profiles.revert')}
              </button>

              <div className="mx-1 my-1.5 h-px bg-overlay/[0.06]" />
              <button
                type="button"
                disabled={!activeProfile || actions.isBuiltin || actions.busy}
                onClick={() => onModeChange('rename')}
                className={`${ITEM} text-on-surface-variant hover:bg-surface-container-highest`}
              >
                {t('profiles.rename')}…
              </button>
              <button
                type="button"
                disabled={!activeProfile || actions.isBuiltin || actions.busy}
                onClick={() => {
                  actions.remove();
                  close();
                }}
                className={`${ITEM} text-negative hover:bg-surface-container-highest`}
              >
                {t('profiles.delete')}
              </button>

              <div className="mx-1 my-1.5 h-px bg-overlay/[0.06]" />
              <button
                type="button"
                disabled={!activeProfile || actions.busy}
                onClick={() =>
                  actions.exportString(() => {
                    setCopied(true);
                    if (copyTimer.current) clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(() => setCopied(false), 1500);
                  })
                }
                className={`${ITEM} text-on-surface-variant hover:bg-surface-container-highest`}
              >
                {copied ? t('profiles.copied') : t('profiles.shareString')}
              </button>
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => onModeChange('import')}
                className={`${ITEM} text-on-surface-variant hover:bg-surface-container-highest`}
              >
                {t('profiles.importString')}
              </button>
              {actions.error && (
                <div className="px-2.5 pb-1 pt-2 text-xs text-negative">{actions.error}</div>
              )}
            </>
          ) : (
            <div className="space-y-2.5 p-1.5">
              <div className="lbl">{formTitle}</div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmName();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    onModeChange('list');
                  }
                }}
                placeholder={
                  mode === 'import'
                    ? t('profiles.importPlaceholder')
                    : t('profiles.namePlaceholder')
                }
                className="input-field !py-2"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  className={buttonClass('text', 'sm')}
                  onClick={() => onModeChange('list')}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!name.trim() || actions.busy}
                  onClick={confirmName}
                  className={buttonClass('solid', 'sm')}
                >
                  {mode === 'saveAs'
                    ? t('profiles.save')
                    : mode === 'rename'
                      ? t('profiles.rename')
                      : t('profiles.import')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
