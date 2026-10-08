import type { CSSProperties } from 'react';

/** Class strings shared by the Sim settings columns. */
export const VALUE = 'font-headline text-[12.5px] font-extrabold text-on-surface';
export const VALUE_INPUT = `bg-transparent text-right tabular-nums focus:outline-none ${VALUE}`;
export const HELP = 'text-xs text-outline';
export const COLUMN_TITLE =
  'flex items-center gap-2 font-headline text-[11px] font-extrabold uppercase tracking-[0.16em] text-on-surface-variant';

/** Fill position for the `.range` track, passed as `--v`. */
export function rangeFill(value: number, min: number, max: number) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return { '--v': `${pct}%` } as CSSProperties;
}

/** "5:00" for a fight length in seconds. */
export function formatFightLength(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
