/** Live sim state folded from SimC's console output, one batch of lines at a time
 *  (the backend keeps only a ring buffer, so nothing here re-reads old lines). */

export interface ComboRun {
  name: string;
  isBaseline: boolean;
  iterations: number;
  /** SimC's running estimate of the iterations the target error needs. */
  target: number;
  mean: number;
  errorPct: number;
  done: boolean;
  /** Seconds the combo took; on its final line. */
  elapsed?: number;
  /** Seconds left for this combo. */
  eta?: number;
  /** Mean DPS per update, for the settling chart; emptied once the combo is done. */
  samples: number[];
}

export interface SimcNote {
  text: string;
  count: number;
}

export interface LiveSim {
  version?: string;
  build?: string;
  options: Record<string, string>;
  /** SimC's banner and options lines, kept for the log's key-lines view. */
  header: string[];
  /** Combos in the current SimC run; 0 for a single-actor sim. */
  total: number;
  /** Combos of the current run, by their 1-based position. */
  combos: Record<number, ComboRun>;
  current?: number;
  /** Seconds left for the whole run, once SimC starts printing it. */
  overallEta?: number;
  notes: SimcNote[];
  /** SimC runs seen; staged sims start a fresh run per stage. */
  runs: number;
}

export const EMPTY_LIVE_SIM: LiveSim = {
  options: {},
  header: [],
  total: 0,
  combos: {},
  notes: [],
  runs: 0,
};

const PROGRESS =
  /^Generating (Baseline|Profileset): (.+?)(?: (\d+)\/(\d+))? \[[=>.]*\] (\d+)\/(\d+) [\d.]+ Mean=([\d.]+) Error=([\d.]+)%(.*)$/;
const VERSION = /^SimulationCraft (\S+).*?(?:git build ([^)]+))?\)?$/;
const OPTIONS = /^Simulating\.\.\. \( (.*) \)$/;
const NOTE = /^(Implementation Not Yet Verified|Warning)\b/i;
const MAX_SAMPLES = 120;

/** "2m, 34s" / "1h, 2m" / "34s" → seconds. */
export function parseDuration(text: string): number | undefined {
  let total = 0;
  let matched = false;
  for (const [, n, unit] of text.matchAll(/(\d+)\s*(h|m|s)/g)) {
    matched = true;
    total += Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
  }
  return matched ? total : undefined;
}

function applyProgress(state: LiveSim, m: RegExpMatchArray): LiveSim {
  const [, kind, name, idx, of, iter, target, mean, err, rest] = m;
  const index = idx ? Number(idx) : 1;
  const iterations = Number(iter);
  const goal = Number(target);
  const tail = rest.trim();
  const overall = tail.match(/\(([^)]*)\)\s*$/);
  const perCombo = (overall ? tail.slice(0, overall.index) : tail).trim();
  const done = iterations >= goal;
  const prev = state.combos[index];
  const combos = { ...state.combos };
  // A new combo starting means the previous one finished.
  if (state.current !== undefined && state.current !== index && combos[state.current]) {
    combos[state.current] = { ...combos[state.current], done: true, eta: undefined, samples: [] };
  }
  combos[index] = {
    name,
    isBaseline: kind === 'Baseline',
    iterations,
    target: goal,
    mean: Number(mean),
    errorPct: Number(err),
    done,
    elapsed: done && /^[\d.]+$/.test(perCombo) ? Number(perCombo) : prev?.elapsed,
    eta: done ? undefined : perCombo.endsWith('sec') ? parseInt(perCombo, 10) : undefined,
    // Only the running combo draws a chart, and it keeps its line after its final
    // update; the combo's samples go once the next one starts (above).
    samples: [...(prev?.samples ?? []), Number(mean)].slice(-MAX_SAMPLES),
  };
  return {
    ...state,
    total: of ? Number(of) : state.total,
    combos,
    current: index,
    overallEta: overall ? parseDuration(overall[1]) : state.overallEta,
  };
}

function addNote(notes: SimcNote[], text: string): SimcNote[] {
  const i = notes.findIndex((n) => n.text === text);
  if (i < 0) return [...notes, { text, count: 1 }];
  const next = [...notes];
  next[i] = { text, count: next[i].count + 1 };
  return next;
}

export function reduceSimcLog(state: LiveSim, lines: string[]): LiveSim {
  let s = state;
  for (const raw of lines) {
    const line = raw.trim();
    const progress = line.match(PROGRESS);
    if (progress) {
      s = applyProgress(s, progress);
      continue;
    }
    const version = line.match(VERSION);
    if (version) {
      // Each SimC run prints its banner: a staged sim's next stage starts fresh.
      s = {
        ...s,
        header: [line],
        version: version[1],
        build: version[2]?.trim(),
        total: 0,
        combos: {},
        current: undefined,
        overallEta: undefined,
        runs: s.runs + 1,
      };
      continue;
    }
    const options = line.match(OPTIONS);
    if (options) {
      const parsed: Record<string, string> = {};
      for (const part of options[1].split(',')) {
        const [k, v] = part.split('=').map((x) => x.trim());
        if (k && v !== undefined) parsed[k] = v;
      }
      s = { ...s, options: parsed, header: [...s.header, line] };
      continue;
    }
    if (NOTE.test(line)) s = { ...s, notes: addNote(s.notes, line) };
  }
  return s;
}

/** Combos in run order. */
export function comboList(state: LiveSim): (ComboRun & { index: number })[] {
  return Object.entries(state.combos)
    .map(([i, c]) => ({ ...c, index: Number(i) }))
    .sort((a, b) => a.index - b.index);
}

/** Seconds left for the run: SimC's own figure, else finished combos' average pace. */
export function estimateEta(state: LiveSim, list = comboList(state)): number | undefined {
  if (state.overallEta !== undefined) return state.overallEta;
  const timed = list.filter((c) => c.done && c.elapsed !== undefined);
  if (!timed.length || !state.total) return list.find((c) => !c.done)?.eta;
  const avg = timed.reduce((sum, c) => sum + (c.elapsed ?? 0), 0) / timed.length;
  const cur = state.current !== undefined ? state.combos[state.current] : undefined;
  const curLeft = cur && !cur.done ? (cur.eta ?? avg * (1 - cur.iterations / cur.target)) : 0;
  const remaining = state.total - list.filter((c) => c.done).length - (cur && !cur.done ? 1 : 0);
  return Math.max(0, Math.round(curLeft + remaining * avg));
}

/** 0..1 through the run, counting the current combo's share. */
export function runFraction(state: LiveSim, list = comboList(state)): number {
  const cur = state.current !== undefined ? state.combos[state.current] : undefined;
  if (!state.total) return cur ? Math.min(1, cur.iterations / cur.target) : 0;
  const done = list.filter((c) => c.done).length;
  const partial = cur && !cur.done ? Math.min(1, cur.iterations / cur.target) : 0;
  return Math.min(1, (done + partial) / state.total);
}
