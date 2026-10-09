'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchArmoryCharacter } from '../../lib/saved-characters';
import { REGIONS } from '../../lib/regions';
import { loadRealms, type RealmInfo } from '../../lib/realms';
import Button from '../ui/Button';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import { useLanguage } from '../../lib/i18n';

interface CharacterImportProps {
  initialValue?: string;
  onApply: (simcInput: string) => void;
  onCancel?: () => void;
  applyLabel?: string;
  autoFocus?: boolean;
  /** Height of the paste box. */
  textareaClassName?: string;
}

/** Paste a SimC export or fetch one from the Armory. Used by the top bar's
 *  editor and the home page's welcome card. */
export default function CharacterImport({
  initialValue = '',
  onApply,
  onCancel,
  applyLabel,
  autoFocus = false,
  textareaClassName = 'h-48',
}: CharacterImportProps) {
  const { t } = useLanguage();
  const [editValue, setEditValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Armory import tab state (the SimC paste box is the other tab)
  const [importTab, setImportTab] = useState<'simc' | 'armory'>('simc');
  const [armoryRegion, setArmoryRegion] = useState<string>('eu');
  const [armoryRealm, setArmoryRealm] = useState(''); // holds the realm slug
  const [armoryName, setArmoryName] = useState('');
  const [armoryFetching, setArmoryFetching] = useState(false);
  const [armoryError, setArmoryError] = useState('');
  const [realmsByRegion, setRealmsByRegion] = useState<Record<string, RealmInfo[]> | null>(null);
  const [realmsError, setRealmsError] = useState(false);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Lazy-load the realm list the first time the Armory tab is opened.
  useEffect(() => {
    if (importTab !== 'armory' || realmsByRegion) return;
    let cancelled = false;
    loadRealms()
      .then((r) => {
        if (!cancelled) {
          setRealmsByRegion(r);
          setRealmsError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setRealmsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [importTab, realmsByRegion]);

  const regionRealms = realmsByRegion?.[armoryRegion] ?? [];
  const canFetch = armoryRealm.trim() !== '' && armoryName.trim() !== '' && !armoryFetching;

  // Shared by both import tabs' footers.
  const cancelButton = onCancel && (
    <Button variant="text" onClick={onCancel}>
      {t('common.cancel')}
    </Button>
  );

  const handleArmoryFetch = useCallback(async () => {
    if (!canFetch) return;
    setArmoryFetching(true);
    setArmoryError('');
    try {
      const { simc_input } = await fetchArmoryCharacter(
        armoryRegion,
        armoryRealm.trim(),
        armoryName.trim()
      );
      // Drop the generated profile into the SimC box for review; Apply persists it.
      setEditValue(simc_input);
      setImportTab('simc');
    } catch (e) {
      setArmoryError(e instanceof Error ? e.message : 'Armory fetch failed');
    } finally {
      setArmoryFetching(false);
    }
  }, [canFetch, armoryRegion, armoryRealm, armoryName]);

  return (
    <div className="space-y-3">
      {/* Import source tabs: paste a SimC string or fetch from the armory */}
      <div className={TABS_TRACK}>
        {(['simc', 'armory'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setImportTab(tab)}
            aria-pressed={importTab === tab}
            className={tabClass(importTab === tab)}
          >
            {tab === 'simc' ? t('layout.importTabSimc') : t('layout.importTabArmory')}
          </button>
        ))}
      </div>

      {importTab === 'simc' ? (
        <>
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel?.();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editValue.trim()) onApply(editValue);
              }
            }}
            placeholder={t('layout.pasteSimcExportFull')}
            className={`input-field resize-y font-mono text-[12px] leading-relaxed ${textareaClassName}`}
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => onApply(editValue)} disabled={!editValue.trim()}>
              {applyLabel ?? t('common.apply')}
            </Button>
            {cancelButton}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select
              value={armoryRegion}
              onChange={(e) => {
                setArmoryRegion(e.target.value);
                setArmoryRealm('');
              }}
              className="sel w-auto text-[13px] uppercase"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
            <select
              value={armoryRealm}
              onChange={(e) => setArmoryRealm(e.target.value)}
              disabled={regionRealms.length === 0}
              className="sel w-48 text-[13px] disabled:opacity-40"
            >
              <option value="">
                {realmsError
                  ? t('layout.armoryRealmsUnavailable')
                  : realmsByRegion
                    ? t('layout.armorySelectRealm')
                    : t('layout.armoryRealmsLoading')}
              </option>
              {regionRealms.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              value={armoryName}
              onChange={(e) => setArmoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel?.();
                if (e.key === 'Enter') handleArmoryFetch();
              }}
              placeholder={t('layout.armoryNamePlaceholder')}
              className="input-field h-[38px] w-auto flex-1 py-0 text-[13px]"
            />
          </div>
          {armoryError && <p className="text-[12px] text-negative">{armoryError}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={handleArmoryFetch} disabled={!canFetch}>
              {armoryFetching && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {armoryFetching ? t('layout.armoryFetching') : t('layout.armoryFetch')}
            </Button>
            {cancelButton}
          </div>
        </div>
      )}
    </div>
  );
}
