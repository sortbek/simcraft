'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { API_URL } from '../lib/api';

const PRESETS = [
  { label: 'Balanced', pct: 0.3, desc: '30%' },
  { label: 'Performance', pct: 0.6, desc: '60%' },
  { label: 'Maximum', pct: 0.9, desc: '90%' },
] as const;

export default function SettingsPopover() {
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

  if (!isDesktop || !maxThreads) return null;

  const selectedIdx = PRESETS.findIndex(
    (p) => Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
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
        <span className="text-[11px] font-medium">Settings</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[60] mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-xl shadow-black/40">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-gray-300">CPU Threads</span>
            <span className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs tabular-nums text-white">
              {threads}/{maxThreads}
            </span>
          </div>
          <div className="flex gap-1.5">
            {PRESETS.map((preset, idx) => {
              const t = Math.max(1, Math.round(maxThreads * preset.pct));
              const active = selectedIdx === idx;
              return (
                <button
                  key={preset.label}
                  onClick={() => setThreads(t)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-center transition-all ${
                    active
                      ? 'border-white bg-white text-black'
                      : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                  }`}
                >
                  <span className="block text-[12px] font-medium">{preset.label}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-600">{t} threads</span>
                </button>
              );
            })}
          </div>

          {/* Max Combinations */}
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-gray-300">Max Gear Combos</span>
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
                className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
