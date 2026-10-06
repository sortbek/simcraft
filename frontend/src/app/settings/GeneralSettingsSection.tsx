'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import { API_URL, apiUrl, fetchJsonOr } from '../lib/api';
import Switch from '../components/ui/Switch';
import CardHeader from '../components/ui/CardHeader';
import { TABS_TRACK, tabClass } from '../components/ui/ToggleButtonGroup';

const THREAD_PRESETS = [
  { labelKey: 'settings.balanced', pct: 0.3 },
  { labelKey: 'settings.performance', pct: 0.6 },
  { labelKey: 'settings.maximum', pct: 0.9 },
] as const;

export default function GeneralSettingsSection() {
  const { t } = useLanguage();
  const { threads, setThreads } = useSimContext();
  const [maxThreads, setMaxThreads] = useState(0);
  const [clipboardSync, setClipboardSync] = useState(false);

  useEffect(() => {
    try {
      setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
    } catch {}

    fetchJsonOr<{ threads?: number }>(apiUrl('/health'), {}).then((data) => {
      if (data.threads) {
        setMaxThreads(data.threads);
        if (threads === 0) {
          setThreads(Math.max(1, Math.round(data.threads * 0.6)));
        }
      }
    });
  }, [setThreads, threads]);

  const selectedPresetIdx = useMemo(
    () =>
      THREAD_PRESETS.findIndex(
        (preset) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * preset.pct)) === threads
      ),
    [maxThreads, threads]
  );

  return (
    <section className="card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
            </svg>
            {t('settings.general')}
          </span>
        }
      />

      <div className="divide-y divide-line/[0.06]">
        {maxThreads > 0 && (
          <div className="p-6">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="lbl">{t('settings.cpuThreads')}</h3>
                <p className="mt-2 text-xs text-on-surface-variant">
                  {t('settings.cpuThreadsDesc')}
                </p>
              </div>
              <div className="text-right">
                <span className="font-headline text-xl font-extrabold tracking-[-0.02em] text-gold">
                  {threads}/{maxThreads}
                </span>
                <p className="lbl mt-1">{t('settings.threadsActive')}</p>
              </div>
            </div>

            <div className={`${TABS_TRACK} grid w-full grid-cols-3`}>
              {THREAD_PRESETS.map((preset, idx) => {
                const threadCount = Math.max(1, Math.round(maxThreads * preset.pct));
                const isActive = selectedPresetIdx === idx;
                return (
                  <button
                    key={preset.labelKey}
                    onClick={() => setThreads(threadCount)}
                    aria-pressed={isActive}
                    className={`${tabClass(isActive)} flex !h-auto flex-col items-center justify-center gap-1 py-2.5`}
                  >
                    <span>{t(preset.labelKey)}</span>
                    <span className="font-sans text-[11px] font-medium normal-case tracking-normal opacity-70">
                      {threadCount} {t('settings.threads')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="lbl mb-2">{t('settings.clipboardSync')}</h3>
              <p className="text-xs italic leading-relaxed text-on-surface-variant">
                {t('settings.clipboardSyncDesc')}
              </p>
            </div>
            <div className="mt-1">
              <Switch
                checked={clipboardSync}
                onChange={(value) => {
                  localStorage.setItem('simhammer_clipboard_sync', String(value));
                  setClipboardSync(value);
                  window.dispatchEvent(new Event('clipboard-sync-changed'));
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
