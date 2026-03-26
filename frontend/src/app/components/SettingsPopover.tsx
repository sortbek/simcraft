"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSimContext } from "./SimContext";

const PRESETS = [
  { label: "Balanced", pct: 0.3, desc: "30%" },
  { label: "Performance", pct: 0.6, desc: "60%" },
  { label: "Maximum", pct: 0.9, desc: "90%" },
] as const;

export default function SettingsPopover() {
  const { threads, setThreads, maxCombinations, setMaxCombinations } =
    useSimContext();
  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = !!window.electronAPI;
    setIsDesktop(desktop);
    if (!desktop) return;

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — threads is intentionally captured once

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!isDesktop || !maxThreads) return null;

  const selectedIdx = PRESETS.findIndex(
    (p) => Math.max(1, Math.round(maxThreads * p.pct)) === threads,
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="h-7 flex items-center gap-1.5 rounded-md px-2 text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
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
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border rounded-xl shadow-xl shadow-black/40 p-4 z-[60]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-gray-300">
              CPU Threads
            </span>
            <span className="text-xs font-mono bg-surface-2 border border-border px-2 py-0.5 rounded text-white tabular-nums">
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
                  className={`flex-1 py-2 px-2 rounded-lg text-center transition-all border ${
                    active
                      ? "bg-white text-black border-white"
                      : "bg-surface-2 text-gray-400 border-border hover:border-gray-500 hover:text-white"
                  }`}
                >
                  <span className="text-[12px] font-medium block">
                    {preset.label}
                  </span>
                  <span
                    className={`text-[10px] block mt-0.5 ${active ? "text-gray-600" : "text-gray-600"}`}
                  >
                    {t} threads
                  </span>
                </button>
              );
            })}
          </div>

          {/* Max Combinations */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-gray-300">
                Max Gear Combos
              </span>
              <input
                type="number"
                min={10}
                max={100000}
                step={50}
                value={maxCombinations}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n) && n > 0) setMaxCombinations(n);
                }}
                className="w-20 text-xs font-mono bg-surface-2 border border-border px-2 py-1 rounded text-white tabular-nums text-center focus:outline-none focus:border-gold/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
