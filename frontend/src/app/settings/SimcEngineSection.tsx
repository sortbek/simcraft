'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { timeAgo } from '../sims/_components/shared';
import CardHeader from '../components/ui/CardHeader';
import Button from '../components/ui/Button';
import {
  AutoSwitch,
  EngineError,
  EngineFooter,
  EngineRow,
  ICON,
  ProgressBar,
  RemoveButton,
  StatusStrip,
  UpToDateMark,
  Version,
  VersionText,
  tagCommit,
  tagDate,
  type EngineStatus,
} from './EngineCard';

interface DesktopAvailableUpdate {
  tag: string;
  type: string;
  assetUrl: string;
  installed: boolean;
}

type Branch = 'weekly' | 'nightly';
const BRANCHES: Branch[] = ['weekly', 'nightly'];
// The keys predate per-branch switches; desktop reads them the same way.
const AUTO_KEY: Record<Branch, string> = {
  weekly: 'simc_auto_update',
  nightly: 'simc_use_nightly',
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function SimcEngineSection() {
  const { t, locale } = useLanguage();
  const [versions, setVersions] = useState<SimcVersion[]>([]);
  // Latest release per branch, from the last check; null until checked.
  const [latest, setLatest] = useState<DesktopAvailableUpdate[] | null>(null);
  const [check, setCheck] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [checkedAt, setCheckedAt] = useState('');
  const [installing, setInstalling] = useState<Branch | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState<Record<Branch, boolean>>({ weekly: true, nightly: false });

  const loadVersions = useCallback(async () => {
    const result = await window.electronAPI!.listSimcVersions();
    setVersions(result.versions);
  }, []);

  useEffect(() => {
    loadVersions();
    window
      .electronAPI!.getSetting(AUTO_KEY.weekly, true)
      .then((weekly) => setAuto((a) => ({ ...a, weekly })));
    window
      .electronAPI!.getSetting(AUTO_KEY.nightly, false)
      .then((nightly) => setAuto((a) => ({ ...a, nightly })));
    const unsubscribe = window.electronAPI!.onSimcDownloadProgress((value) => setProgress(value));
    return () => unsubscribe();
  }, [loadVersions]);

  const runCheck = async () => {
    setCheck('checking');
    setError('');
    try {
      const result = await window.electronAPI!.checkSimcUpdates();
      if (result.length === 0) throw new Error(t('settings.noReleasesFound'));
      setLatest(result);
      setCheck('ok');
      setCheckedAt(new Date().toISOString());
      return result;
    } catch (err) {
      setCheck('error');
      setError(err instanceof Error ? err.message : t('settings.checkUpdatesFailed'));
      return null;
    }
  };

  const install = async (branch: Branch) => {
    const release = (latest ?? (await runCheck()))?.find((r) => r.type === branch);
    if (!release) return;
    setInstalling(branch);
    setProgress(0);
    setError('');
    try {
      const result = await window.electronAPI!.installSimcVersion({
        tag: release.tag,
        assetUrl: release.assetUrl,
      });
      if (!result.success) throw new Error(result.error);
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.installFailed'));
    } finally {
      setInstalling(null);
    }
  };

  const remove = async (tag: string) => {
    setError('');
    try {
      const result = await window.electronAPI!.removeSimcVersion(tag);
      if (!result.success) throw new Error(result.error);
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.removeFailed'));
    }
  };

  const toggleAuto = (branch: Branch, value: boolean) => {
    setAuto((a) => ({ ...a, [branch]: value }));
    window.electronAPI!.setSetting(AUTO_KEY[branch], value);
  };

  const source = versions.find((v) => v.type === 'source');
  const installed = (b: Branch) => versions.find((v) => v.type === b);
  const known = (b: Branch) => latest?.find((r) => r.type === b);
  const hasUpdate = (b: Branch) => {
    const k = known(b);
    return !!installed(b) && !!k && k.tag !== installed(b)!.tag;
  };
  const pct = `${Math.round(progress * 100)}%`;
  const update = BRANCHES.find(hasUpdate);

  let status: EngineStatus;
  if (source) {
    status = {
      tone: 'info',
      icon: ICON.code,
      title: t('settings.simc.sourceTitle'),
      sub: t('settings.simc.sourceSub', {
        build: tagDate(source.tag, locale) ?? source.tag.replace(/^source-/, ''),
      }),
    };
  } else if (installing) {
    status = {
      tone: 'busy',
      title: t(installed(installing) ? 'settings.simc.updating' : 'settings.simc.installing', {
        branch: cap(installing),
        pct,
      }),
      sub: t('settings.simc.buildOf', { date: tagDate(known(installing)?.tag, locale) ?? '' }),
      progress,
    };
  } else if (check === 'checking') {
    status = {
      tone: 'busy',
      title: t('settings.engine.checkingTitle'),
      sub: t('settings.simc.checkingSub'),
    };
  } else if (check === 'error') {
    status = {
      tone: 'err',
      icon: ICON.alert,
      title: t('settings.engine.checkFailed'),
      sub: t('settings.simc.checkFailedSub'),
    };
  } else if (update) {
    status = {
      tone: 'info',
      icon: ICON.down,
      title: t('settings.simc.newBuild', { branch: cap(update) }),
      sub: t('settings.engine.readyToInstall', { date: tagDate(known(update)!.tag, locale) ?? '' }),
    };
  } else if (!BRANCHES.some(installed)) {
    status = {
      tone: 'warn',
      icon: ICON.alert,
      title: t('settings.simc.noneTitle'),
      sub: t('settings.simc.noneSub'),
    };
  } else if (check === 'ok') {
    status = {
      tone: 'ok',
      icon: ICON.check,
      title: t('settings.engine.upToDate'),
      sub: t('settings.engine.checkedAgo', { time: timeAgo(checkedAt, t) }),
    };
  } else {
    status = {
      tone: 'idle',
      icon: ICON.dot,
      title: t('settings.engine.installed'),
      sub: t('settings.engine.notChecked'),
    };
  }

  const action = source ? (
    <Button size="sm" variant="quiet" onClick={() => remove(source.tag)}>
      {t('settings.simc.removeBuild')}
    </Button>
  ) : installing ? null : check === 'checking' ? (
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
    <Button size="sm" variant={BRANCHES.some(installed) ? 'gold' : 'quiet'} onClick={runCheck}>
      {t('settings.checkForUpdates')}
    </Button>
  );

  return (
    <div className="card overflow-hidden">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
            </svg>
            SimC Engine
          </span>
        }
      />
      <StatusStrip status={status} action={action} />
      <div>
        {BRANCHES.map((b) => {
          const v = installed(b);
          const busy = installing === b;
          const locked = !!source;
          const k = known(b);
          return (
            <EngineRow
              key={b}
              name={cap(b)}
              dim={locked}
              control={
                <AutoSwitch
                  checked={auto[b]}
                  onChange={(value) => toggleAuto(b, value)}
                  label={t('settings.engine.autoUpdate')}
                  ariaLabel={`${t('settings.engine.autoUpdate')} ${cap(b)}`}
                  tip={t('settings.simc.autoTip')}
                  disabled={locked}
                />
              }
              actions={
                !locked &&
                !busy && (
                  <>
                    {v && (
                      <RemoveButton onClick={() => remove(v.tag)} label={t('settings.remove')} />
                    )}
                    {(!v || hasUpdate(b)) && (
                      <Button
                        size="sm"
                        onClick={() => install(b)}
                        disabled={!!installing || check === 'checking'}
                      >
                        {t(v ? 'settings.update' : 'settings.install')}
                      </Button>
                    )}
                  </>
                )
              }
            >
              <VersionText>
                {busy ? (
                  <>
                    <span className="text-outline">{t('settings.engine.downloading')}</span>
                    <span className="font-semibold tabular-nums text-on-surface">{pct}</span>
                    <ProgressBar value={progress} className="w-[120px]" />
                  </>
                ) : !v ? (
                  <span className="text-outline">{t('settings.notInstalled')}</span>
                ) : (
                  <>
                    <Version date={tagDate(v.tag, locale)} commit={tagCommit(v.tag)} />
                    {hasUpdate(b) ? (
                      <span className="whitespace-nowrap font-semibold text-gold">
                        → {tagDate(k!.tag, locale)}
                      </span>
                    ) : (
                      k && check === 'ok' && <UpToDateMark title={t('settings.engine.upToDate')} />
                    )}
                  </>
                )}
              </VersionText>
            </EngineRow>
          );
        })}
      </div>
      <EngineError message={error} />
      <EngineFooter>{t('settings.simc.note')}</EngineFooter>
    </div>
  );
}
