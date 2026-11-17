'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import Button from '../components/ui/Button';
import CardHeader from '../components/ui/CardHeader';
import Switch from '../components/ui/Switch';

function Row({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-line/[0.06] bg-surface-container-low p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-on-surface">{title}</p>
        <p className="mt-0.5 text-[11px] text-on-surface-variant/70">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** The WoW Forever engine on desktop: on or off, kept up to date or not, and what is installed.
 *  It installs in the background, and a new engine is used from the next sim without a restart. */
export default function ForeverEngineSection() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ForeverEngineStatus | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [working, setWorking] = useState<'check' | 'install' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setStatus(await window.electronAPI!.getForeverStatus());
  }, []);

  useEffect(() => {
    refresh();
    // The first install runs in the background after startup; show it once it lands.
    const timer = setInterval(refresh, 5000);
    const unsubscribe = window.electronAPI!.onForeverDownloadProgress((value) =>
      setProgress(value)
    );
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  const run = async (kind: 'check' | 'install', task: () => Promise<void>) => {
    setWorking(kind);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  };
  const check = () =>
    run('check', async () => {
      setLatest((await window.electronAPI!.checkForeverUpdate()).latest);
      await refresh();
    });
  const install = () =>
    run('install', async () => {
      setProgress(0);
      setStatus(await window.electronAPI!.installForeverLatest());
    });

  if (!status) return null;
  const updateAvailable = !!latest && latest !== status.installed;
  const installing = working === 'install' || status.busy;

  return (
    <div className="card">
      <CardHeader
        title={t('settings.forever.title')}
        right={
          <Button
            size="sm"
            variant="quiet"
            onClick={check}
            disabled={!status.enabled || working !== null}
          >
            {working === 'check' ? t('settings.checking') : t('settings.checkForUpdates')}
          </Button>
        }
      />
      <div className="space-y-2 p-6">
        <Row title={t('settings.forever.enabled')} help={t('settings.forever.enabledHelp')}>
          <Switch
            checked={status.enabled}
            aria-label={t('settings.forever.enabled')}
            onChange={async (value) =>
              setStatus(await window.electronAPI!.setForeverEnabled(value))
            }
          />
        </Row>
        <Row title={t('settings.forever.autoUpdate')} help={t('settings.forever.autoUpdateHelp')}>
          <Switch
            checked={status.autoUpdate}
            aria-label={t('settings.forever.autoUpdate')}
            onChange={async (value) =>
              setStatus(await window.electronAPI!.setForeverAutoUpdate(value))
            }
          />
        </Row>
        <Row
          title={
            status.installed
              ? t('settings.forever.installed', { tag: status.installed })
              : t(installing ? 'settings.forever.installing' : 'settings.forever.notInstalled')
          }
          help={
            status.installed
              ? t('settings.forever.version', {
                  commit: status.engineCommit ?? '?',
                  build: status.clientBuild ?? '?',
                })
              : t('settings.forever.notInstalledHelp')
          }
        >
          {installing ? (
            <span className="text-xs tabular-nums text-on-surface-variant">
              {Math.round(progress * 100)}%
            </span>
          ) : updateAvailable || (!status.installed && status.enabled) ? (
            <Button size="sm" onClick={install}>
              {status.installed
                ? t('settings.forever.update', { tag: latest ?? '' })
                : t('settings.forever.install')}
            </Button>
          ) : latest ? (
            <span className="text-xs text-on-surface-variant">
              {t('settings.forever.upToDate')}
            </span>
          ) : null}
        </Row>
        {error && <p className="text-xs text-negative">{error}</p>}
      </div>
    </div>
  );
}
