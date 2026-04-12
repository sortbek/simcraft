'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import { useIsDesktop } from '../lib/useIsDesktop';
import { API_URL } from '../lib/api';

const THREAD_PRESETS = [
  { labelKey: 'settings.balanced', pct: 0.3, desc: '30%' },
  { labelKey: 'settings.performance', pct: 0.6, desc: '60%' },
  { labelKey: 'settings.maximum', pct: 0.9, desc: '90%' },
] as const;

// ── SimC Version Management ─────────────────────────────────────

function SimcVersionManager() {
  const [versions, setVersions] = useState<SimcVersion[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [updates, setUpdates] = useState<SimcAvailableUpdate[]>([]);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [useNightly, setUseNightly] = useState(false);

  const loadVersions = useCallback(async () => {
    const result = await window.electronAPI!.listSimcVersions();
    setVersions(result.versions);
    setActive(result.active);
  }, []);

  useEffect(() => {
    loadVersions();
    window.electronAPI!.getSetting('simc_auto_update', true).then(setAutoUpdate);
    window.electronAPI!.getSetting('simc_use_nightly', false).then(setUseNightly);
    const unsub = window.electronAPI!.onSimcDownloadProgress((p) => setProgress(p));
    return () => unsub();
  }, [loadVersions]);

  const handleCheckUpdates = async () => {
    setChecking(true);
    setError('');
    try {
      const available = await window.electronAPI!.checkSimcUpdates();
      setUpdates(available);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async (update: SimcAvailableUpdate) => {
    setInstalling(update.tag);
    setProgress(0);
    setError('');
    try {
      const result = await window.electronAPI!.installSimcVersion({
        tag: update.tag,
        assetUrl: update.assetUrl,
      });
      if (!result.success) throw new Error(result.error);
      await loadVersions();
      // Refresh updates list
      setUpdates((prev) => prev.map((u) => (u.tag === update.tag ? { ...u, installed: true } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
    }
  };

  const handleSetActive = async (tag: string) => {
    setError('');
    try {
      const result = await window.electronAPI!.setActiveSimcVersion(tag);
      if (!result.success) throw new Error(result.error);
      setActive(tag);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch version');
    }
  };

  const handleRemove = async (tag: string) => {
    setError('');
    try {
      const result = await window.electronAPI!.removeSimcVersion(tag);
      if (!result.success) throw new Error(result.error);
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove version');
    }
  };

  const formatTag = (tag: string) => {
    const date = tag.replace(/^(weekly|nightly)-/, '');
    return date;
  };

  const newUpdates = updates.filter((u) => !u.installed);

  return (
    <div className="space-y-4">
      {/* Installed versions */}
      <div className="space-y-2">
        {versions.length === 0 ? (
          <p className="text-sm text-on-surface-variant/60">No SimC versions installed.</p>
        ) : (
          versions.map((v) => {
            const isActive = v.tag === active;
            return (
              <div
                key={v.tag}
                className={`flex items-center justify-between rounded-lg px-4 py-3 transition-colors ${
                  isActive
                    ? 'bg-primary-container/10 ring-1 ring-primary/30'
                    : 'bg-surface-container-highest'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                      v.type === 'weekly'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-tertiary/15 text-tertiary'
                    }`}
                  >
                    {v.type}
                  </span>
                  <span className="font-mono text-sm text-on-surface">{formatTag(v.tag)}</span>
                  {isActive && (
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!isActive && (
                    <>
                      <button
                        onClick={() => handleSetActive(v.tag)}
                        className="rounded px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => handleRemove(v.tag)}
                        className="rounded px-3 py-1.5 text-xs font-medium text-error/60 hover:bg-error-container/10 hover:text-error transition-colors"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Available updates */}
      {newUpdates.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
            Available
          </h4>
          {newUpdates.map((u) => (
            <div
              key={u.tag}
              className="flex items-center justify-between rounded-lg bg-surface-container px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                    u.type === 'weekly'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-tertiary/15 text-tertiary'
                  }`}
                >
                  {u.type}
                </span>
                <span className="font-mono text-sm text-on-surface">{formatTag(u.tag)}</span>
              </div>
              <button
                onClick={() => handleInstall(u)}
                disabled={installing === u.tag}
                className="rounded bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {installing === u.tag ? `${Math.round(progress * 100)}%` : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Auto-update + nightly toggles + check button */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const next = !autoUpdate;
                setAutoUpdate(next);
                window.electronAPI!.setSetting('simc_auto_update', next);
              }}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                autoUpdate ? 'bg-gold' : 'bg-surface-container-highest'
              }`}
            >
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  autoUpdate ? 'left-[18px] bg-black' : 'left-0.5 bg-on-surface-variant'
                }`}
              />
            </button>
            <span className="text-sm text-on-surface-variant">Auto-update releases</span>
          </div>
          <button
            onClick={handleCheckUpdates}
            disabled={checking}
            className="rounded-lg bg-surface-container-highest px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>

        {autoUpdate && (
          <div className="flex items-center gap-3 pl-12">
            <button
              type="button"
              onClick={() => {
                const next = !useNightly;
                setUseNightly(next);
                window.electronAPI!.setSetting('simc_use_nightly', next);
              }}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                useNightly ? 'bg-gold' : 'bg-surface-container-highest'
              }`}
            >
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  useNightly ? 'left-[18px] bg-black' : 'left-0.5 bg-on-surface-variant'
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-on-surface-variant">Use nightly builds</span>
              <p className="text-[11px] leading-relaxed text-on-surface-variant/40">
                Downloads a new SimC version every day. Nightly builds may be unstable.
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-error">{error}</p>
      )}
    </div>
  );
}

// ── Settings Page ───────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useLanguage();
  const isDesktop = useIsDesktop();
  const { threads, setThreads, maxCombinations, setMaxCombinations } = useSimContext();
  const [maxThreads, setMaxThreads] = useState(0);
  const [clipboardSync, setClipboardSync] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;

    try {
      setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
    } catch {}

    try {
      const stored = localStorage.getItem('simhammer_max_combinations');
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (Number.isFinite(parsed) && parsed > 0) setMaxCombinations(parsed);
      }
    } catch {}

    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.threads) {
          setMaxThreads(data.threads);
          if (threads === 0) {
            setThreads(Math.max(1, Math.round(data.threads * 0.6)));
          }
        }
      })
      .catch(() => {});
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPresetIdx = THREAD_PRESETS.findIndex(
    (p) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-20">
      <h1 className="font-headline text-2xl font-black text-on-surface">{t('common.settings')}</h1>

      {/* SimC Engine — desktop only */}
      {isDesktop && (
        <section className="space-y-4">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">SimC Engine</h2>
            <p className="mt-1 text-sm text-on-surface-variant/60">
              Manage SimulationCraft versions used for running simulations.
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5">
            <SimcVersionManager />
          </div>
        </section>
      )}

      {/* General Settings — desktop only */}
      {isDesktop && (
        <section className="space-y-4">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">General</h2>
          </div>
          <div className="space-y-6 rounded-xl border border-outline-variant/20 bg-surface-container-low p-5">
            {/* CPU Threads */}
            {maxThreads > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[15px] font-medium text-on-surface-variant">
                    {t('settings.cpuThreads')}
                  </span>
                  <span className="rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xs tabular-nums text-on-surface">
                    {threads}/{maxThreads}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {THREAD_PRESETS.map((preset, idx) => {
                    const threadCount = Math.max(1, Math.round(maxThreads * preset.pct));
                    const isActive = selectedPresetIdx === idx;
                    return (
                      <button
                        key={preset.labelKey}
                        onClick={() => setThreads(threadCount)}
                        className={`flex-1 rounded-lg px-2 py-2 text-center transition-all ${
                          isActive
                            ? 'bg-white text-black'
                            : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <span className="block text-[14px] font-medium">{t(preset.labelKey)}</span>
                        <span className="mt-0.5 block text-[12px] text-on-surface-variant/40">
                          {threadCount} {t('settings.threads')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Clipboard Auto-Import */}
            <div className="border-t border-outline-variant/10 pt-5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <span className="text-[15px] font-medium text-on-surface-variant">
                    {t('settings.clipboardSync')}
                  </span>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface-variant/40">
                    {t('settings.clipboardSyncDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = localStorage.getItem('simhammer_clipboard_sync') !== 'true';
                    localStorage.setItem('simhammer_clipboard_sync', String(next));
                    setClipboardSync(next);
                    window.dispatchEvent(new Event('clipboard-sync-changed'));
                  }}
                  className={`relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors ${
                    clipboardSync ? 'bg-gold' : 'bg-surface-container-highest'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                      clipboardSync ? 'left-[18px] bg-black' : 'left-0.5 bg-on-surface-variant'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Max Combinations */}
            <div className="border-t border-outline-variant/10 pt-5">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-on-surface-variant">
                  {t('settings.maxGearCombos')}
                </span>
                <input
                  type="number"
                  min={10}
                  max={100000}
                  step={50}
                  value={maxCombinations ?? 500}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n > 0) setMaxCombinations(n);
                  }}
                  className="w-20 rounded bg-surface-container-highest px-2 py-1 text-center font-mono text-xs tabular-nums text-on-surface [appearance:textfield] focus:outline-none focus:ring-1 focus:ring-gold/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Non-desktop: nothing to show yet */}
      {!isDesktop && (
        <p className="text-sm text-on-surface-variant/60">
          Settings are only available in the desktop app.
        </p>
      )}
    </div>
  );
}
