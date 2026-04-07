'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { API_URL } from '../../lib/api';

const PRESETS = [
  { labelKey: 'settings.balanced', pct: 0.3, desc: '30%' },
  { labelKey: 'settings.performance', pct: 0.6, desc: '60%' },
  { labelKey: 'settings.maximum', pct: 0.9, desc: '90%' },
] as const;

export default function SettingsPopover() {
  const { t } = useLanguage();
  const { threads, setThreads, maxCombinations, setMaxCombinations } = useSimContext();
  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = !!window.electronAPI;
    setIsDesktop(desktop);
    if (!desktop) return;

    setMaxCombinations(readStoredMaxCombinations());

    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.threads) {
          setMaxThreads(data.threads);
          if (threads === 0) {
            // No saved preference — default to 60%
            setThreads(Math.max(1, Math.round(data.threads * 0.6)));
          }
        }
      })
      .catch(() => {});
    function readStoredMaxCombinations(): number {
      try {
        const value = localStorage.getItem('simhammer_max_combinations');
        if (value == null) return 500;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
      } catch {
        return 500;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- threads is intentionally captured once

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedIdx = PRESETS.findIndex(
    (p) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface-variant"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
        </svg>
        <span className="text-[13px] font-medium">{t('common.settings')}</span>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full z-[60] mb-2 w-80 rounded-xl bg-surface-container-high p-4 shadow-2xl shadow-black/40">
          {/* Desktop-only settings */}
          {isDesktop && maxThreads > 0 && (
            <>
              {/* CPU Threads */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[15px] font-medium text-on-surface-variant">{t('settings.cpuThreads')}</span>
                  <span className="rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xs tabular-nums text-on-surface">
                    {threads}/{maxThreads}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {PRESETS.map((preset, idx) => {
                    const threadCount = Math.max(1, Math.round(maxThreads * preset.pct));
                    const active = selectedIdx === idx;
                    return (
                      <button
                        key={preset.labelKey}
                        onClick={() => setThreads(threadCount)}
                        className={`flex-1 rounded-lg px-2 py-2 text-center transition-all ${
                          active
                            ? 'bg-white text-black'
                            : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <span className="block text-[14px] font-medium">{t(preset.labelKey)}</span>
                        <span className="mt-0.5 block text-[12px] text-on-surface-variant/40">{threadCount} {t('settings.threads')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Max Combinations */}
              <div className="mt-4 border-t border-outline-variant/10 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-on-surface-variant">{t('settings.maxGearCombos')}</span>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
