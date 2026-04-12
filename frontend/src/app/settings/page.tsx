'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import { useIsDesktop } from '../lib/useIsDesktop';
import { API_URL } from '../lib/api';

const THREAD_PRESETS = [
  { labelKey: 'settings.balanced', pct: 0.3 },
  { labelKey: 'settings.performance', pct: 0.6 },
  { labelKey: 'settings.maximum', pct: 0.9 },
] as const;

// ── Toggle Switch ───────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-10 h-5 bg-surface-container-highest rounded-full peer peer-checked:bg-primary-container after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );
}

// ── SimC Version Management ─────────────────────────────────────

function SimcEngineSection() {
  const [versions, setVersions] = useState<SimcVersion[]>([]);
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
      setUpdates((prev) => prev.map((u) => (u.tag === update.tag ? { ...u, installed: true } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
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

  const formatDate = (tag: string) => tag.replace(/^(weekly|nightly)-/, '');

  // Build per-branch rows: weekly and nightly
  const branches = ['weekly', 'nightly'] as const;
  const branchData = branches.map((branch) => {
    const installed = versions.find((v) => v.type === branch);
    const available = updates.find((u) => u.type === branch && !u.installed);
    return { branch, installed, available };
  });

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary-fixed-dim">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
          </svg>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em]">SimC Engine</h2>
        </div>
        <button
          onClick={handleCheckUpdates}
          disabled={checking}
          className="text-[10px] bg-surface-container-highest px-3 py-1.5 rounded text-primary hover:bg-surface-bright transition-colors disabled:opacity-50 font-bold uppercase tracking-wider"
        >
          {checking ? 'Checking...' : 'Check for Updates'}
        </button>
      </div>

      <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-4 space-y-3">
        {/* Column headers */}
        <div className="flex items-center px-3 pb-2 border-b border-outline-variant/20">
          <span className="w-12 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 text-center shrink-0">Auto</span>
          <span className="ml-4 flex-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">Branch / Version</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">Actions</span>
        </div>

      <div className="space-y-2">
        {branchData.map(({ branch, installed, available }) => (
          <div
            key={branch}
            className="flex items-center justify-between p-3 bg-surface-container rounded-lg border border-outline-variant/10"
          >
            {/* Auto-update toggle — w-12 to match header */}
            <div className="w-12 flex justify-center shrink-0">
              <Toggle
                checked={branch === 'weekly' ? autoUpdate : useNightly}
                onChange={(v) => {
                  if (branch === 'weekly') {
                    setAutoUpdate(v);
                    window.electronAPI!.setSetting('simc_auto_update', v);
                  } else {
                    setUseNightly(v);
                    window.electronAPI!.setSetting('simc_use_nightly', v);
                  }
                }}
              />
            </div>

            {/* Branch info */}
            <div className="flex-1 ml-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold capitalize">{branch}</p>
                {branch === 'nightly' && (
                  <svg className="h-3.5 w-3.5 text-error/70" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                  </svg>
                )}
              </div>
              {installed ? (
                <p className="text-[10px] text-on-surface-variant/70">
                  Installed: {formatDate(installed.tag)}
                  {available && (
                    <span className="text-primary ml-2">
                      Update available: {formatDate(available.tag)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-[10px] text-on-surface-variant/50">
                  {available ? `Available: ${formatDate(available.tag)}` : 'Not installed'}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {available && (
                <button
                  onClick={() => handleInstall(available)}
                  disabled={installing === available.tag}
                  className="text-[10px] font-bold uppercase py-1 px-3 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  {installing === available.tag ? `${Math.round(progress * 100)}%` : installed ? 'Update' : 'Install'}
                </button>
              )}
              {installed && (
                <button
                  onClick={() => handleRemove(installed.tag)}
                  className="text-[10px] font-bold uppercase py-1 px-3 text-error/60 hover:bg-error/10 hover:text-error rounded transition-all"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-error pt-1">{error}</p>}
      </div>
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
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      {/* Header */}
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold text-primary tracking-tight uppercase">
          {t('common.settings')}
        </h1>
        <p className="text-on-surface-variant">Configure the simulation engine and preferences.</p>
      </header>

      {/* SimC Engine — desktop only */}
      {isDesktop && (
        <section className="space-y-4">
          <SimcEngineSection />
        </section>
      )}

      {/* General Settings — desktop only */}
      {isDesktop && (
        <section className="space-y-4 pt-4">
          <div className="flex items-center gap-2 text-primary-fixed-dim">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
            </svg>
            <h2 className="text-sm font-bold uppercase tracking-[0.2em]">General</h2>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* CPU Threads */}
            {maxThreads > 0 && (
              <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-5">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                      {t('settings.cpuThreads')}
                    </h3>
                    <p className="text-xs text-on-surface-variant">
                      Allocated processing power for simulation threads.
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-primary font-headline">
                      {threads}/{maxThreads}
                    </span>
                    <p className="text-[10px] text-on-surface-variant font-bold uppercase">
                      Threads Active
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 bg-surface-container-lowest p-1.5 rounded-lg">
                  {THREAD_PRESETS.map((preset, idx) => {
                    const threadCount = Math.max(1, Math.round(maxThreads * preset.pct));
                    const isActive = selectedPresetIdx === idx;
                    return (
                      <button
                        key={preset.labelKey}
                        onClick={() => setThreads(threadCount)}
                        className={`flex flex-col items-center justify-center py-3 rounded-md transition-all ${
                          isActive
                            ? 'bg-primary-container text-on-primary ring-1 ring-primary/30 shadow-lg shadow-primary/10'
                            : 'hover:bg-surface-bright'
                        }`}
                      >
                        <span
                          className={`text-xs font-bold ${
                            isActive ? 'uppercase tracking-tight font-extrabold' : 'text-on-surface'
                          }`}
                        >
                          {t(preset.labelKey)}
                        </span>
                        <span className={`text-[10px] ${isActive ? 'opacity-80' : 'text-on-surface-variant'}`}>
                          {threadCount} {t('settings.threads')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Auto-Import and Gear Combos row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* WoW Import */}
              <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-5 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-on-surface uppercase mb-1">
                      {t('settings.clipboardSync')}
                    </h3>
                    <p className="text-xs leading-relaxed text-on-surface-variant italic">
                      {t('settings.clipboardSyncDesc')}
                    </p>
                  </div>
                  <div className="mt-1">
                    <Toggle
                      checked={clipboardSync}
                      onChange={(v) => {
                        localStorage.setItem('simhammer_clipboard_sync', String(v));
                        setClipboardSync(v);
                        window.dispatchEvent(new Event('clipboard-sync-changed'));
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Max Gear Combos */}
              <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-5 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                    {t('settings.maxGearCombos')}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    The threshold for combinatorial optimization.
                  </p>
                </div>
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
                  className="w-28 bg-surface-container-highest border-none text-primary font-bold text-right rounded-md focus:ring-1 focus:ring-primary h-10 px-3 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {!isDesktop && (
        <p className="text-sm text-on-surface-variant/60">
          Settings are only available in the desktop app.
        </p>
      )}
    </div>
  );
}
