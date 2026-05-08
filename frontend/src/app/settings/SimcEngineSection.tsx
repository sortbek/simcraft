'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SettingsToggle from './SettingsToggle';

interface DesktopAvailableUpdate {
  tag: string;
  type: string;
  assetUrl: string;
  installed: boolean;
}

function formatVersionTag(tag: string): string {
  return tag.replace(/^(weekly|nightly)-/, '').replace(/^source-/, '');
}

export default function SimcEngineSection() {
  const [versions, setVersions] = useState<SimcVersion[]>([]);
  const [updates, setUpdates] = useState<DesktopAvailableUpdate[]>([]);
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
    const unsubscribe = window.electronAPI!.onSimcDownloadProgress((value) => setProgress(value));
    return () => unsubscribe();
  }, [loadVersions]);

  const handleCheckUpdates = async () => {
    setChecking(true);
    setError('');
    try {
      const result = await window.electronAPI!.checkSimcUpdates();
      setUpdates(result);
      if (result.length === 0) {
        setError('No SimC releases were found for this platform.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async (update: DesktopAvailableUpdate) => {
    setInstalling(update.tag);
    setProgress(0);
    setError('');
    try {
      const result = await window.electronAPI!.installSimcVersion({
        tag: update.tag,
        assetUrl: update.assetUrl,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
      await loadVersions();
      setUpdates((current) =>
        current.map((item) => (item.tag === update.tag ? { ...item, installed: true } : item))
      );
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
      if (!result.success) {
        throw new Error(result.error);
      }
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove version');
    }
  };

  const sourceVersion = useMemo(() => versions.find((v) => v.type === 'source'), [versions]);

  const branchData = useMemo(() => {
    const branches = ['weekly', 'nightly'] as const;
    return branches.map((branch) => ({
      branch,
      installed: versions.find((version) => version.type === branch),
      available: updates.find((update) => update.type === branch && !update.installed),
    }));
  }, [versions, updates]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-primary-fixed-dim flex items-center gap-2">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
          </svg>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em]">SimC Engine</h2>
        </div>
        <button
          onClick={handleCheckUpdates}
          disabled={checking || !!sourceVersion}
          className="rounded bg-surface-container-highest px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-surface-bright disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Check for Updates'}
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
        {sourceVersion && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                  </svg>
                  <p className="text-sm font-semibold text-primary">Built from Source</p>
                </div>
                <p className="mt-0.5 text-[10px] text-on-surface-variant/70">
                  {formatVersionTag(sourceVersion.tag)}
                </p>
              </div>
              <button
                onClick={() => handleRemove(sourceVersion.tag)}
                className="rounded px-3 py-1 text-[10px] font-bold uppercase text-error/60 transition-all hover:bg-error/10 hover:text-error"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center border-b border-outline-variant/20 px-3 pb-2">
          <span className="w-12 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
            Auto
          </span>
          <span className="ml-4 flex-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
            Branch / Version
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50">
            Actions
          </span>
        </div>

        <div className={`space-y-2${sourceVersion ? 'pointer-events-none opacity-40' : ''}`}>
          {branchData.map(({ branch, installed, available }) => (
            <div
              key={branch}
              className="flex items-center justify-between rounded-lg border border-outline-variant/10 bg-surface-container p-3"
            >
              <div className="flex w-12 shrink-0 justify-center">
                <SettingsToggle
                  checked={branch === 'weekly' ? autoUpdate : useNightly}
                  onChange={(value) => {
                    if (branch === 'weekly') {
                      setAutoUpdate(value);
                      window.electronAPI!.setSetting('simc_auto_update', value);
                    } else {
                      setUseNightly(value);
                      window.electronAPI!.setSetting('simc_use_nightly', value);
                    }
                  }}
                />
              </div>

              <div className="ml-4 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold capitalize">{branch}</p>
                  {branch === 'nightly' && (
                    <svg
                      className="h-3.5 w-3.5 text-error/70"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                  )}
                </div>
                {installed ? (
                  <p className="text-[10px] text-on-surface-variant/70">
                    Installed: {formatVersionTag(installed.tag)}
                    {available && (
                      <span className="ml-2 text-primary">
                        Update available: {formatVersionTag(available.tag)}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[10px] text-on-surface-variant/50">
                    {available ? `Available: ${formatVersionTag(available.tag)}` : 'Not installed'}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {available && (
                  <button
                    onClick={() => handleInstall(available)}
                    disabled={installing === available.tag}
                    className="rounded bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase text-primary transition-all hover:bg-primary/20 disabled:opacity-50"
                  >
                    {installing === available.tag
                      ? `${Math.round(progress * 100)}%`
                      : installed
                        ? 'Update'
                        : 'Install'}
                  </button>
                )}
                {installed && (
                  <button
                    onClick={() => handleRemove(installed.tag)}
                    className="rounded px-3 py-1 text-[10px] font-bold uppercase text-error/60 transition-all hover:bg-error/10 hover:text-error"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {sourceVersion && (
          <p className="text-[10px] text-on-surface-variant/50">
            Weekly and Nightly branches are disabled while a source build is active.
          </p>
        )}

        {error && <p className="pt-1 text-xs text-error">{error}</p>}
      </div>
    </div>
  );
}
