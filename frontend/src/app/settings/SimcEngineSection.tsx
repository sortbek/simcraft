'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import Switch from '../components/ui/Switch';
import CardHeader from '../components/ui/CardHeader';
import Button from '../components/ui/Button';

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
  const { t } = useLanguage();
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
        setError(t('settings.noReleasesFound'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.checkUpdatesFailed'));
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
      setError(err instanceof Error ? err.message : t('settings.installFailed'));
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
      setError(err instanceof Error ? err.message : t('settings.removeFailed'));
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
    <div className="card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
            </svg>
            SimC Engine
          </span>
        }
        right={
          <Button
            size="sm"
            variant="quiet"
            onClick={handleCheckUpdates}
            disabled={checking || !!sourceVersion}
          >
            {checking ? t('settings.checking') : t('settings.checkForUpdates')}
          </Button>
        }
      />

      <div className="space-y-3 p-6">
        {sourceVersion && (
          <div className="rounded-[8px] border border-gold/35 bg-gold/[0.05] p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                  </svg>
                  <p className="text-sm font-semibold text-primary">
                    {t('settings.builtFromSource')}
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] text-on-surface-variant/70">
                  {formatVersionTag(sourceVersion.tag)}
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => handleRemove(sourceVersion.tag)}>
                {t('settings.remove')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center border-b border-line/[0.06] px-3 pb-2">
          <span className="lbl w-12 shrink-0 text-center">{t('settings.auto')}</span>
          <span className="lbl ml-4 flex-1">{t('settings.branchVersion')}</span>
          <span className="lbl">{t('settings.actions')}</span>
        </div>

        <div className={`space-y-2 ${sourceVersion ? 'pointer-events-none opacity-40' : ''}`}>
          {branchData.map(({ branch, installed, available }) => (
            <div
              key={branch}
              className="flex items-center justify-between rounded-[8px] border border-line/[0.06] bg-surface-container-low p-3"
            >
              <div className="flex w-12 shrink-0 justify-center">
                <Switch
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
                  <p className="text-sm font-semibold capitalize text-on-surface">{branch}</p>
                </div>
                {installed ? (
                  <p className="text-[11px] text-on-surface-variant/70">
                    {t('settings.installedTag', { tag: formatVersionTag(installed.tag) })}
                    {available && (
                      <span className="ml-2 text-primary">
                        {t('settings.updateAvailableTag', { tag: formatVersionTag(available.tag) })}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-on-surface-variant/50">
                    {available
                      ? t('settings.availableTag', { tag: formatVersionTag(available.tag) })
                      : t('settings.notInstalled')}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {available && (
                  <Button
                    size="sm"
                    onClick={() => handleInstall(available)}
                    disabled={installing === available.tag}
                  >
                    {installing === available.tag
                      ? `${Math.round(progress * 100)}%`
                      : installed
                        ? t('settings.update')
                        : t('settings.install')}
                  </Button>
                )}
                {installed && (
                  <Button size="sm" variant="danger" onClick={() => handleRemove(installed.tag)}>
                    {t('settings.remove')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {sourceVersion && (
          <p className="text-[11px] text-on-surface-variant/50">{t('settings.sourceBuildNote')}</p>
        )}

        {error && <p className="pt-1 text-xs text-negative">{error}</p>}
      </div>
    </div>
  );
}
