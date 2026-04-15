'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '../lib/adminAuth';
import {
  fetchInstalledVersions,
  checkForUpdates,
  type InstalledVersions,
  type AvailableUpdate,
} from '../lib/simcUpdates';
import SettingsToggle from '../settings/SettingsToggle';

function formatVersionTag(tag: string): string {
  return tag.replace(/^(weekly|nightly|source)-/, '');
}

interface Settings {
  max_combinations: number;
  max_scenarios: number;
}

interface EnvInfo {
  simc_enabled_branches: string;
  simc_check_interval: string;
}

export default function AdminLimitsSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [simc, setSimc] = useState<InstalledVersions | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [updates, setUpdates] = useState<AvailableUpdate[]>([]);
  const [checkError, setCheckError] = useState('');

  const enabledBranches = (env?.simc_enabled_branches ?? 'weekly').split(',').map((b) => b.trim());

  useEffect(() => {
    adminFetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        setEnv(data.env);
      })
      .catch(() => {});

    fetchInstalledVersions().then(setSimc).catch(() => {});
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    setChecking(true);
    setCheckError('');
    setUpdates([]);
    try {
      const result = await checkForUpdates();
      setUpdates(result.updates.filter((u) => !u.installed));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  }, []);

  const handleInstall = useCallback(async (update: AvailableUpdate) => {
    setInstalling(update.branch);
    setCheckError('');
    try {
      const res = await adminFetch('/api/admin/simc/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: update.tag, asset_url: update.asset_url }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Install failed');

      // Refresh installed versions and clear the update entry
      try { setSimc(await fetchInstalledVersions()); } catch {}
      setUpdates((prev) => prev.filter((u) => u.branch !== update.branch));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
    }
  }, []);

  const handleRemove = useCallback(async (branch: string) => {
    setCheckError('');
    try {
      const res = await adminFetch(`/api/admin/simc/${branch}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Remove failed');
      try { setSimc(await fetchInstalledVersions()); } catch {}
      setUpdates([]);
      // Auto-check for updates so the install button appears
      handleCheckUpdates();
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Remove failed');
    }
  }, [handleCheckUpdates]);

  const save = useCallback(async (partial: Partial<Settings>) => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }, []);

  if (!settings) {
    return <div className="text-sm text-on-surface-variant/60">Loading settings...</div>;
  }

  const isSource = simc?.default_branch === 'source' || simc?.branches.includes('source');
  const sourceTag = simc?.versions?.source?.tag;
  const allBranches = ['weekly', 'nightly'] as const;

  return (
    <>
      {/* SimC Engine — matches desktop SimcEngineSection layout */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary-fixed-dim">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
            </svg>
            <h2 className="text-sm font-bold uppercase tracking-[0.2em]">SimC Engine</h2>
          </div>
          <button
            onClick={handleCheckUpdates}
            disabled={checking || !!isSource}
            className="rounded bg-surface-container-highest px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-surface-bright disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
          {isSource && sourceTag && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                </svg>
                <p className="text-sm font-semibold text-primary">Built from Source</p>
              </div>
              <p className="mt-0.5 text-[10px] text-on-surface-variant/70">
                {formatVersionTag(sourceTag)}
              </p>
            </div>
          )}

          {/* Column headers */}
          <div className="flex items-center border-b border-outline-variant/20 px-3 pb-2">
            <span className="w-12 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
              Active
            </span>
            <span className="ml-4 flex-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
              Branch / Version
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
              Actions
            </span>
          </div>

          {/* Per-branch rows */}
          <div className={`space-y-2${isSource ? ' pointer-events-none opacity-40' : ''}`}>
            {allBranches.map((branch) => {
              const isEnabled = enabledBranches.includes(branch);
              const info = simc?.versions[branch];
              const tag = info?.tag;
              const available = updates.find((u) => u.branch === branch);

              return (
                <div
                  key={branch}
                  className="flex items-center justify-between rounded-lg border border-outline-variant/10 bg-surface-container p-3"
                >
                  <div className="flex w-12 shrink-0 justify-center">
                    <SettingsToggle
                      checked={isEnabled}
                      onChange={() => {}}
                    />
                  </div>

                  <div className="ml-4 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold capitalize">{branch}</p>
                      {branch === simc?.default_branch && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                          default
                        </span>
                      )}
                      {branch === 'nightly' && (
                        <svg className="h-3.5 w-3.5 text-error/70" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                        </svg>
                      )}
                    </div>
                    {tag ? (
                      <p className="text-[10px] text-on-surface-variant/70">
                        Installed: {formatVersionTag(tag)}
                        {available && (
                          <span className="ml-2 text-primary">
                            Update available: {formatVersionTag(available.tag)}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[10px] text-on-surface-variant/50">
                        {isEnabled ? 'Pending download...' : 'Not enabled'}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {available && (
                      <button
                        onClick={() => handleInstall(available)}
                        disabled={installing === branch}
                        className="rounded bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase text-primary transition-all hover:bg-primary/20 disabled:opacity-50"
                      >
                        {installing === branch ? 'Installing...' : 'Update'}
                      </button>
                    )}
                    {tag && (
                      <button
                        onClick={() => handleRemove(branch)}
                        className="rounded px-3 py-1 text-[10px] font-bold uppercase text-error/60 transition-all hover:bg-error/10 hover:text-error"
                      >
                        Remove
                      </button>
                    )}
                    {!available && !tag && isEnabled && installing === branch && (
                      <span className="rounded bg-tertiary/10 px-3 py-1 text-[10px] font-bold uppercase text-tertiary">
                        Downloading
                      </span>
                    )}
                    {!isEnabled && !tag && (
                      <span className="rounded bg-surface-container-highest px-3 py-1 text-[10px] font-bold uppercase text-on-surface-variant/50">
                        Disabled
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isSource && (
            <p className="text-[10px] text-on-surface-variant/50">
              Weekly and Nightly branches are disabled while a source build is active.
            </p>
          )}

          {checkError && <p className="pt-1 text-xs text-error">{checkError}</p>}

          {!isSource && (
            <p className="pt-1 text-[10px] italic text-on-surface-variant/40">
              Branch toggles are controlled by the SIMC_ENABLED_BRANCHES environment variable.
              Updates are downloaded automatically every {env?.simc_check_interval ?? '3600'}s.
            </p>
          )}
        </div>
      </div>

      {/* Server Limits */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-primary-fixed-dim">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Server Limits</h2>
          {saved && (
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                Max Combinations
              </h3>
              <p className="text-xs text-on-surface-variant">0 = unlimited</p>
            </div>
            <input
              type="number"
              min={0}
              step={50}
              value={settings.max_combinations}
              disabled={saving}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (Number.isFinite(val) && val >= 0) {
                  setSettings((prev) => (prev ? { ...prev, max_combinations: val } : prev));
                }
              }}
              onBlur={() => save({ max_combinations: settings.max_combinations })}
              className="h-10 w-28 rounded-md border-none bg-surface-container-highest px-3 text-right font-bold text-primary focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                Max Scenarios
              </h3>
              <p className="text-xs text-on-surface-variant">0 = disabled</p>
            </div>
            <input
              type="number"
              min={0}
              step={1}
              value={settings.max_scenarios}
              disabled={saving}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (Number.isFinite(val) && val >= 0) {
                  setSettings((prev) => (prev ? { ...prev, max_scenarios: val } : prev));
                }
              }}
              onBlur={() => save({ max_scenarios: settings.max_scenarios })}
              className="h-10 w-28 rounded-md border-none bg-surface-container-highest px-3 text-right font-bold text-primary focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </>
  );
}
