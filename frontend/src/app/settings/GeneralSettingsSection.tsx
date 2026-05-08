'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import { API_URL } from '../lib/api';
import SettingsToggle from './SettingsToggle';

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
  }, [setThreads, threads]);

  const selectedPresetIdx = useMemo(
    () =>
      THREAD_PRESETS.findIndex(
        (preset) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * preset.pct)) === threads
      ),
    [maxThreads, threads]
  );

  return (
    <section className="space-y-4 pt-4">
      <div className="text-primary-fixed-dim flex items-center gap-2">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
        </svg>
        <h2 className="text-sm font-bold uppercase tracking-[0.2em]">General</h2>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {maxThreads > 0 && (
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                  {t('settings.cpuThreads')}
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Allocated processing power for simulation threads.
                </p>
              </div>
              <div className="text-right">
                <span className="font-headline text-xl font-black text-primary">
                  {threads}/{maxThreads}
                </span>
                <p className="text-[10px] font-bold uppercase text-on-surface-variant">
                  Threads Active
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-container-lowest p-1.5">
              {THREAD_PRESETS.map((preset, idx) => {
                const threadCount = Math.max(1, Math.round(maxThreads * preset.pct));
                const isActive = selectedPresetIdx === idx;
                return (
                  <button
                    key={preset.labelKey}
                    onClick={() => setThreads(threadCount)}
                    className={`flex flex-col items-center justify-center rounded-md py-3 transition-all ${
                      isActive
                        ? 'bg-primary-container text-on-primary shadow-lg shadow-primary/10 ring-1 ring-primary/30'
                        : 'hover:bg-surface-bright'
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${
                        isActive ? 'font-extrabold uppercase tracking-tight' : 'text-on-surface'
                      }`}
                    >
                      {t(preset.labelKey)}
                    </span>
                    <span
                      className={`text-[10px] ${isActive ? 'opacity-80' : 'text-on-surface-variant'}`}
                    >
                      {threadCount} {t('settings.threads')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="mb-1 text-sm font-bold uppercase text-on-surface">
                {t('settings.clipboardSync')}
              </h3>
              <p className="text-xs italic leading-relaxed text-on-surface-variant">
                {t('settings.clipboardSyncDesc')}
              </p>
            </div>
            <div className="mt-1">
              <SettingsToggle
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
