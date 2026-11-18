'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { timeAgo } from '../sims/_components/shared';
import Button from '../components/ui/Button';
import CardHeader from '../components/ui/CardHeader';
import Switch from '../components/ui/Switch';
import {
  AutoSwitch,
  EngineError,
  EngineFooter,
  EngineRow,
  ICON,
  ProgressBar,
  StatusStrip,
  UpToDateMark,
  Version,
  VersionText,
  tagCommit,
  tagDate,
  type EngineStatus,
} from './EngineCard';

/** The WoW Forever engine on desktop: on or off, kept up to date or not, and what is installed.
 *  It installs in the background, and a new engine is used from the next sim without a restart. */
export default function ForeverEngineSection() {
  const { t, locale } = useLanguage();
  const [status, setStatus] = useState<ForeverEngineStatus | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [check, setCheck] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [checkedAt, setCheckedAt] = useState('');
  const [installing, setInstalling] = useState(false);
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

  const runCheck = async () => {
    setCheck('checking');
    setError('');
    try {
      setLatest((await window.electronAPI!.checkForeverUpdate()).latest);
      setCheck('ok');
      setCheckedAt(new Date().toISOString());
      await refresh();
    } catch (err) {
      setCheck('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const install = async () => {
    setInstalling(true);
    setProgress(0);
    setError('');
    try {
      setStatus(await window.electronAPI!.installForeverLatest());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };
  const setEnabled = async (value: boolean) =>
    setStatus(await window.electronAPI!.setForeverEnabled(value));

  if (!status) return null;
  const off = !status.enabled;
  const busy = installing || status.busy;
  const hasUpdate = !!latest && !!status.installed && latest !== status.installed;
  const pct = `${Math.round(progress * 100)}%`;
  const installedDate = tagDate(status.installed, locale);

  let info: EngineStatus;
  if (off) {
    info = {
      tone: 'idle',
      icon: ICON.power,
      title: t('settings.forever.offTitle'),
      sub: t('settings.forever.offSub'),
    };
  } else if (busy) {
    info = {
      tone: 'busy',
      title: t(status.installed ? 'settings.forever.updating' : 'settings.forever.installing', {
        pct,
      }),
      sub: t('settings.forever.size'),
      progress,
    };
  } else if (check === 'checking') {
    info = {
      tone: 'busy',
      title: t('settings.engine.checkingTitle'),
      sub: t('settings.forever.checkingSub'),
    };
  } else if (!status.installed) {
    info = {
      tone: 'warn',
      icon: ICON.alert,
      title: t('settings.forever.missingTitle'),
      sub: t('settings.forever.missingSub'),
    };
  } else if (check === 'error') {
    info = {
      tone: 'err',
      icon: ICON.alert,
      title: t('settings.engine.checkFailed'),
      sub: t('settings.forever.checkFailedSub'),
    };
  } else if (hasUpdate) {
    info = {
      tone: 'info',
      icon: ICON.down,
      title: t('settings.forever.newEngine'),
      sub: t('settings.engine.readyToInstall', { date: tagDate(latest, locale) ?? '' }),
    };
  } else if (check === 'ok') {
    info = {
      tone: 'ok',
      icon: ICON.check,
      title: t('settings.engine.upToDate'),
      sub: t('settings.engine.checkedAgo', { time: timeAgo(checkedAt, t) }),
    };
  } else {
    info = {
      tone: 'idle',
      icon: ICON.dot,
      title: t('settings.engine.installed'),
      sub: t('settings.engine.notChecked'),
    };
  }

  const action = off ? (
    <Button size="sm" onClick={() => setEnabled(true)}>
      {t('settings.forever.turnOn')}
    </Button>
  ) : busy ? null : check === 'checking' ? (
    <Button size="sm" variant="quiet" disabled>
      {t('settings.checking')}
    </Button>
  ) : check === 'error' ? (
    <Button size="sm" onClick={runCheck}>
      {ICON.refresh}
      {t('settings.engine.tryAgain')}
    </Button>
  ) : check === 'ok' ? (
    <Button size="sm" variant="quiet" onClick={runCheck}>
      {t('settings.engine.checkAgain')}
    </Button>
  ) : (
    <Button size="sm" variant={status.installed ? 'gold' : 'quiet'} onClick={runCheck}>
      {t('settings.checkForUpdates')}
    </Button>
  );

  return (
    <div className="card overflow-hidden">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <svg
              className="h-4 w-4 text-gold"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <path d="M7.5 8.5a3.5 3.5 0 100 7c2.5 0 3.5-2 4.5-3.5s2-3.5 4.5-3.5a3.5 3.5 0 110 7c-2.5 0-3.5-2-4.5-3.5S10 8.5 7.5 8.5z" />
            </svg>
            {t('settings.forever.title')}
          </span>
        }
      />
      <StatusStrip status={info} action={action} />
      <div>
        <EngineRow
          name={t('settings.forever.enabled')}
          control={
            <Switch
              checked={status.enabled}
              aria-label={t('settings.forever.enabled')}
              onChange={setEnabled}
            />
          }
        >
          <span className="basis-full text-[12.5px] text-outline">
            {t('settings.forever.enabledHelp')}
          </span>
        </EngineRow>
        <EngineRow
          name={t('settings.forever.engine')}
          dim={off}
          control={
            <AutoSwitch
              checked={status.autoUpdate}
              onChange={async (value) =>
                setStatus(await window.electronAPI!.setForeverAutoUpdate(value))
              }
              label={t('settings.engine.autoUpdate')}
              ariaLabel={t('settings.forever.autoUpdateLabel')}
              tip={t('settings.forever.autoTip')}
              disabled={off}
            />
          }
          actions={
            !off &&
            !busy &&
            (!status.installed || hasUpdate) && (
              <Button size="sm" onClick={install} disabled={check === 'checking'}>
                {t(status.installed ? 'settings.update' : 'settings.forever.install')}
              </Button>
            )
          }
        >
          <VersionText>
            {busy && !off ? (
              <>
                <span className="text-outline">{t('settings.engine.downloading')}</span>
                <span className="font-semibold tabular-nums text-on-surface">{pct}</span>
                <ProgressBar value={progress} className="w-[120px]" />
              </>
            ) : !status.installed ? (
              <span className="text-outline">
                {t(off ? 'settings.forever.notDownloaded' : 'settings.notInstalled')}
              </span>
            ) : (
              <>
                <Version
                  date={installedDate}
                  commit={status.engineCommit?.slice(0, 7) ?? tagCommit(status.installed)}
                />
                {hasUpdate && !off ? (
                  <span className="whitespace-nowrap font-semibold text-gold">
                    → {tagDate(latest, locale)}
                  </span>
                ) : (
                  check === 'ok' && !off && <UpToDateMark title={t('settings.engine.upToDate')} />
                )}
                {status.clientBuild && (
                  <span className="text-outline">
                    {t('settings.forever.gameBuild', { build: status.clientBuild })}
                  </span>
                )}
              </>
            )}
          </VersionText>
        </EngineRow>
      </div>
      <EngineError message={error} />
      <EngineFooter>{t('settings.forever.note')}</EngineFooter>
    </div>
  );
}
