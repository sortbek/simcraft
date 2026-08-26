'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import {
  defaultProfile,
  isDefaultProfile,
  isProfileSupported,
  listProfiles,
  type SimProfile,
} from '../../lib/sim-profiles';

/** Footer-bar dropdown: shows the active profile (dirty dot when edited) and
 *  applies a saved profile on pick. Management lives in the drawer
 *  (ProfileControls). */
export default function ProfilePicker() {
  const { t } = useLanguage();
  const { activeProfile, applyProfile, profileDirty } = useSimContext();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<SimProfile[]>([]);
  // Distinct from an empty list: "no saved profiles yet" invites the user to
  // recreate profiles that a failed load only made invisible.
  const [loadFailed, setLoadFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listProfiles().then(
      (list) => {
        setProfiles(list);
        setLoadFailed(false);
      },
      () => setLoadFailed(true)
    );
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (p: SimProfile) => {
    applyProfile(p);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
          open
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
        }`}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4h12M2 8h12M2 12h7" />
        </svg>
        <span className="max-w-[140px] truncate normal-case">
          {activeProfile
            ? isDefaultProfile(activeProfile)
              ? t('profiles.default')
              : activeProfile.name
            : t('profiles.title')}
        </span>
        {activeProfile && profileDirty && (
          <span
            title={t('profiles.edited')}
            className="inline-block h-1.5 w-1.5 rounded-full bg-gold"
          />
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-outline-variant/20 bg-surface-container-high p-2 shadow-xl">
          <button
            type="button"
            onClick={() => pick(defaultProfile())}
            className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10 hover:text-primary ${
              activeProfile && isDefaultProfile(activeProfile)
                ? 'text-primary'
                : 'text-on-surface-variant'
            }`}
          >
            {t('profiles.default')}
          </button>
          <div className="my-1 h-px bg-outline-variant/20" />
          {loadFailed ? (
            <div className="px-3 py-2 text-xs text-red-400">{t('profiles.loadFailed')}</div>
          ) : (
            profiles.length === 0 && (
              <div className="px-3 py-2 text-xs text-on-surface-variant">{t('profiles.empty')}</div>
            )
          )}
          {profiles.map((p) => {
            // Newer-schema profiles are listed but not applicable (see spec
            // §Versioning). The title lives on the wrapper: browsers suppress
            // hover events (and thus the tooltip) on a disabled button.
            const unsupported = !isProfileSupported(p);
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
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    unsupported
                      ? 'cursor-not-allowed text-on-surface-variant/40'
                      : `hover:bg-primary/10 hover:text-primary ${
                          activeProfile?.id === p.id ? 'text-primary' : 'text-on-surface-variant'
                        }`
                  }`}
                >
                  {p.name}
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
