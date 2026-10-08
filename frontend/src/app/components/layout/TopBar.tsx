'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSimContext } from '../sim-config/SimContext';
import { specDisplayName } from '../../lib/types';
import {
  getCharacters,
  upsertCharacter,
  deleteCharacter,
  fetchArmoryCharacter,
  type SavedCharacter,
} from '../../lib/saved-characters';
import { REGIONS } from '../../lib/regions';
import { loadRealms, type RealmInfo } from '../../lib/realms';
import WindowControls from './WindowTitlebar';
import DesktopAppLink from './DesktopAppLink';
import ActiveSimsIndicator from './ActiveSimsIndicator';
import Button from '../ui/Button';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { useLanguage } from '../../lib/i18n';
import { isValidSimcExport, validateChecksum } from '../../lib/simcDetect';
import { parseCharacterInfo } from '../../lib/character';
import { parseShareInput } from '../../lib/share/link';

export default function TopBar() {
  const isDesktop = useIsDesktop();
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showChars, setShowChars] = useState(false);
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareError, setShareError] = useState('');
  const { simcInput, setSimcInput, unsimmableSpec } = useSimContext();
  const containerRef = useRef<HTMLDivElement>(null);
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
  const cancelButton = (
    <Button variant="text" onClick={() => setEditing(false)}>
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

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const checksumWarning = useMemo(
    () => simcInput.trim().length > 50 && validateChecksum(simcInput) === 'invalid',
    [simcInput]
  );

  const refreshCharacters = useCallback(() => {
    getCharacters().then(setCharacters);
  }, []);

  useEffect(() => {
    refreshCharacters();
  }, [refreshCharacters]);

  // Auto-save character when SimC input changes (debounced)
  useEffect(() => {
    if (!simcInput.trim()) return;
    const timeout = setTimeout(() => {
      upsertCharacter(simcInput).then((result) => {
        if (result) refreshCharacters();
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [simcInput, refreshCharacters]);

  // Close on outside click
  useEffect(() => {
    if (!editing && !showChars && !shareOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false);
        setShowChars(false);
        setShareOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editing, showChars, shareOpen]);

  // Focus textarea when opening editor
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current && textareaRef.current) {
      textareaRef.current.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  // Clipboard sync on focus (desktop only, opt-in via Settings)
  const [clipboardSync, setClipboardSync] = useState(() => {
    try {
      return localStorage.getItem('simhammer_clipboard_sync') === 'true';
    } catch {
      return false;
    }
  });
  const [clipboardNotice, setClipboardNotice] = useState('');
  const simcInputRef = useRef(simcInput);
  simcInputRef.current = simcInput;

  // Re-read setting when Settings popover toggles it (same-tab)
  useEffect(() => {
    function onStorage() {
      try {
        setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
      } catch {}
    }
    window.addEventListener('storage', onStorage);
    // Poll on focus too: storage event doesn't fire same-tab
    function onFocusCheck() {
      try {
        setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
      } catch {}
    }
    window.addEventListener('focus', onFocusCheck);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocusCheck);
    };
  }, []);

  const lastImportedClipboard = useRef('');

  useEffect(() => {
    if (!isDesktop || !clipboardSync) return;

    async function handleFocus() {
      try {
        const text = await window.electronAPI!.readClipboard();
        if (!text || !isValidSimcExport(text)) return;
        // Skip if we already imported this exact clipboard content
        if (text === lastImportedClipboard.current) return;
        lastImportedClipboard.current = text;
        const nameMatch = text.match(/^\w+="(.+)"$/m);
        const charName = nameMatch?.[1] ?? 'Unknown';
        setSimcInput(text);
        setClipboardNotice(t('layout.clipboardImported', { charName }));
        setTimeout(() => setClipboardNotice(''), 4000);
      } catch {
        /* clipboard read failed, ignore */
      }
    }

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isDesktop, clipboardSync, setSimcInput, t]);

  const goToShare = useCallback(
    (id: string) => {
      // /shared reads window.location.search once on mount, so navigating from
      // /shared?id=A to /shared?id=B needs a full navigation to remount.
      if (pathname === '/shared') window.location.assign(`/shared?id=${id}`);
      else router.push(`/shared?id=${id}`);
    },
    [pathname, router]
  );

  // simhammer:// links opened while the app runs arrive here instead of a reload.
  useEffect(() => {
    return window.electronAPI?.onOpenShare?.((raw) => {
      const id = parseShareInput(raw);
      if (id) goToShare(id);
    });
  }, [goToShare]);

  const openShareLink = () => {
    const id = parseShareInput(shareText);
    if (!id) {
      setShareError(t('shared.invalidLink'));
      return;
    }
    setShareOpen(false);
    setShareText('');
    setShareError('');
    goToShare(id);
  };

  return (
    <div
      ref={containerRef}
      className="desktop-drag relative z-50 flex h-16 shrink-0 items-center justify-between gap-2.5 border-b border-line/[0.06] bg-background px-7"
    >
      <div className="desktop-no-drag relative flex items-center gap-2.5">
        <button
          onClick={() => {
            if (characters.length > 0) {
              setShowChars((v) => !v);
              setEditing(false);
            } else {
              setEditing(true);
              setEditValue(simcInput);
            }
          }}
          className="group flex h-[38px] items-center gap-2.5 rounded-[6px] px-3 transition-colors duration-[120ms] hover:bg-surface-container-high"
        >
          <svg
            className="h-[15px] w-[15px] text-outline"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" />
          </svg>
          {characterInfo ? (
            <span className="font-headline text-sm font-bold text-on-surface">
              {characterInfo.name}
              <span className="ml-2.5 font-sans font-medium text-outline">
                {specDisplayName(characterInfo.spec)}
              </span>
            </span>
          ) : (
            <span className="text-sm font-medium text-outline">{t('layout.noCharacter')}</span>
          )}
          {characters.length > 0 && (
            <svg
              className={`h-[13px] w-[13px] text-outline transition-transform duration-200 ${showChars ? 'rotate-180' : ''}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          )}
        </button>

        {/* Inline SimC preview — click to open full editor below */}
        <button
          onClick={() => {
            setEditing((v) => {
              if (!v) setEditValue(simcInput);
              return !v;
            });
            setShowChars(false);
          }}
          className="flex h-[34px] w-[260px] min-w-0 shrink items-center rounded-[6px] border border-line/[0.06] bg-surface-container px-3 transition-colors hover:border-line/[0.11]"
        >
          <span className="truncate font-mono text-xs text-outline">
            {simcInput
              ? simcInput.split('\n')[0].slice(0, 40) + (simcInput.length > 40 ? '...' : '')
              : t('layout.pasteSimcExport')}
          </span>
        </button>

        {/* Paste a simhammer.com share link to open it in /shared */}
        <div className="relative">
          <button
            onClick={() => setShareOpen((v) => !v)}
            title={t('shared.openLink')}
            className="grid h-[34px] w-[34px] place-items-center rounded-[6px] border border-line/[0.06] bg-surface-container text-outline transition-colors duration-[120ms] hover:border-line/[0.11] hover:text-on-surface"
          >
            <svg
              className="h-[15px] w-[15px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
          {shareOpen && (
            <div className="popover absolute left-0 top-full z-50 mt-2 w-72 p-3">
              <div className="flex gap-2">
                <input
                  value={shareText}
                  onChange={(e) => setShareText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setShareOpen(false);
                    if (e.key === 'Enter') openShareLink();
                  }}
                  placeholder={t('shared.openLinkPlaceholder')}
                  aria-label={t('shared.openLink')}
                  autoFocus
                  className="input-field h-[34px] min-w-0 flex-1 py-0 text-[13px]"
                />
                <Button onClick={openShareLink}>{t('shared.openLink')}</Button>
              </div>
              {shareError && <p className="mt-2 text-[12px] text-negative">{shareError}</p>}
            </div>
          )}
        </div>

        {unsimmableSpec && (
          <span
            className="flex h-6 items-center gap-1 rounded-[5px] bg-negative/10 px-2 text-[11px] font-medium text-negative"
            title={t('validation.unsupportedSpec', { spec: unsimmableSpec.label })}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2L1.5 13h13L8 2z" />
              <path d="M8 6v3M8 11v.5" />
            </svg>
            {t('validation.unsupportedSpecBadge')}
          </span>
        )}

        {checksumWarning && (
          <span
            className="flex h-6 items-center gap-1 rounded-[5px] bg-warning/10 px-2 text-[11px] font-medium text-warning"
            title={t('validation.checksumInvalid')}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2L1.5 13h13L8 2z" />
              <path d="M8 6v3M8 11v.5" />
            </svg>
            {t('validation.checksumWarning')}
          </span>
        )}

        {showChars && characters.length > 0 && (
          <div className="popover absolute left-0 top-full z-50 mt-2 w-80">
            <div className="max-h-72 space-y-0.5 overflow-y-auto p-2">
              {characters.map((char) => {
                const isActive =
                  characterInfo?.name === char.name && simcInput.includes(`server=${char.realm}`);
                return (
                  <div
                    key={char.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      isActive ? 'bg-primary/[0.08]' : 'hover:bg-surface-container-highest'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSimcInput(char.simc_input);
                        setShowChars(false);
                      }}
                      className={`min-w-0 flex-1 text-left transition-colors ${
                        isActive ? 'text-primary' : 'text-on-surface'
                      }`}
                    >
                      <div className="text-sm font-medium">{char.name}</div>
                      <div className="text-[12px] text-on-surface-variant/50">
                        {specDisplayName(char.spec)} {char.class} &middot; {char.realm}
                      </div>
                    </button>
                    <button
                      onClick={() =>
                        deleteCharacter(char.id)
                          .catch((e) => console.error('Delete character failed', e))
                          .finally(refreshCharacters)
                      }
                      className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant/30 transition-colors hover:bg-negative/10 hover:text-negative"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="desktop-no-drag ml-auto flex items-center gap-3">
        <ActiveSimsIndicator />
        {!isDesktop && <DesktopAppLink />}
        <WindowControls />
      </div>

      {clipboardNotice && (
        <div className="popover absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-[8px] border-gold/35 px-4 py-2">
          <p className="whitespace-nowrap text-xs font-medium text-primary">{clipboardNotice}</p>
        </div>
      )}

      {/* Expanded import editor — drops below the top bar */}
      {editing && (
        <div className="popover desktop-no-drag absolute left-0 right-0 top-full z-50 rounded-none border-x-0 border-t-0 px-6 py-4">
          <div className="mx-auto max-w-3xl space-y-3">
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
                    if (e.key === 'Escape') setEditing(false);
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (editValue.trim()) {
                        setSimcInput(editValue);
                        setEditing(false);
                      }
                    }
                  }}
                  placeholder={t('layout.pasteSimcExportFull')}
                  className="input-field h-48 resize-y font-mono text-[12px] leading-relaxed"
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setSimcInput(editValue);
                      setEditing(false);
                    }}
                    disabled={!editValue.trim()}
                  >
                    {t('common.apply')}
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
                      if (e.key === 'Escape') setEditing(false);
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
        </div>
      )}
    </div>
  );
}
