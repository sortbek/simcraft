'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useSimContext } from '../components/sim-config/SimContext';

interface JobSummary {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  sim_type: string;
  created_at: string;
  fight_style: string;
  iterations: number;
  error_message: string | null;
  player_name: string | null;
  player_class: string | null;
  realm: string | null;
  dps: number | null;
  batch_id: string | null;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  done: { dot: 'bg-emerald-500', label: 'Completed' },
  running: { dot: 'bg-amber-500 animate-pulse', label: 'Running' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  pending: { dot: 'bg-on-surface-variant', label: 'Pending' },
  cancelled: { dot: 'bg-on-surface-variant', label: 'Cancelled' },
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
};

const SIM_TYPE_COLORS: Record<string, string> = {
  quick: 'bg-primary/10 text-primary border-primary/20',
  top_gear: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  droptimizer: 'bg-secondary/10 text-secondary border-secondary/20',
};

function formatDps(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return t('time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { h: hours });
  return t('time.daysAgo', { d: Math.floor(hours / 24) });
}

function extractCharacter(simcInput: string): { name: string; realm: string } | null {
  let name = '';
  let realm = '';
  for (const line of simcInput.split('\n')) {
    const trimmed = line.trim();
    if (!name) {
      const match = trimmed.match(
        /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)"/
      );
      if (match) name = match[1];
    }
    if (!realm && trimmed.startsWith('server=')) {
      realm = trimmed.slice(7);
    }
    if (name && realm) break;
  }
  if (name && realm) {
    try {
      localStorage.setItem('simhammer_last_character', JSON.stringify({ name, realm }));
    } catch {}
    return { name, realm };
  }
  return null;
}

/* ── Row ─────────────────────────────────────────────────── */

function SimRow({ sim }: { sim: JobSummary }) {
  const { t } = useLanguage();
  const isFailed = sim.status === 'failed';
  const status = STATUS_STYLES[sim.status] || STATUS_STYLES.pending;
  const statusLabel = {
    done: t('status.completed'),
    running: t('status.running'),
    failed: t('status.failed'),
    pending: t('status.pending'),
    cancelled: t('status.cancelled'),
  }[sim.status] || t('status.pending');
  const simTypeLabel = {
    quick: t('simType.quickSim'),
    top_gear: t('simType.topGear'),
    droptimizer: t('simType.dropFinder'),
  }[sim.sim_type] || sim.sim_type;

  return (
    <Link
      href={`/sim/${sim.id}`}
      className={`grid grid-cols-12 px-6 py-5 items-center hover:bg-surface-container-high/40 transition-all cursor-pointer group ${isFailed ? 'opacity-60' : ''}`}
    >
      {/* Col 1 – Status dot */}
      <div className="col-span-1 flex items-center">
        <div className={`w-2.5 h-2.5 rounded-full ${status.dot}`} title={statusLabel} />
      </div>

      {/* Col 2 – Name */}
      <div className="col-span-3 flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-bold text-on-surface truncate">
            {sim.player_name || (isFailed ? t('history.failedSimulation') : t('history.simulation'))}
          </p>
          <p
            className={`text-[10px] font-medium truncate ${isFailed ? 'text-error' : 'text-on-surface-variant'}`}
          >
            {isFailed && sim.error_message
              ? sim.error_message.slice(0, 60)
              : sim.player_class || sim.sim_type}
          </p>
        </div>
      </div>

      {/* Col 3 – Sim Type */}
      <div className="col-span-2 text-center">
        <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${SIM_TYPE_COLORS[sim.sim_type] || 'bg-surface-container-highest text-on-surface-variant border-outline-variant/10'}`}>
          {simTypeLabel}
        </span>
      </div>

      {/* Col 4 – DPS */}
      <div className="col-span-2 text-right">
        <p className="text-xl font-black text-on-surface font-headline leading-none">
          {sim.dps ? formatDps(sim.dps) : '---'}
        </p>
      </div>

      {/* Col 5 – Fight Style */}
      <div className="col-span-2 text-center">
        <span className="px-2 py-1 bg-surface-container-highest text-[10px] font-bold uppercase tracking-wider rounded border border-outline-variant/10">
          {sim.fight_style}
        </span>
      </div>

      {/* Col 6 – Time */}
      <div className="col-span-2 text-right">
        <span className="text-[10px] text-on-surface-variant opacity-60">
          {timeAgo(sim.created_at, t)}
        </span>
      </div>
    </Link>
  );
}

/* ── Grouping ────────────────────────────────────────────── */

type HistoryEntry =
  | { type: 'single'; sim: JobSummary }
  | { type: 'batch'; batchId: string; sims: JobSummary[] };

function groupByBatch(sims: JobSummary[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batchMap = new Map<string, JobSummary[]>();
  const singles: { index: number; sim: JobSummary }[] = [];

  sims.forEach((sim, index) => {
    if (sim.batch_id) {
      let group = batchMap.get(sim.batch_id);
      if (!group) {
        group = [];
        batchMap.set(sim.batch_id, group);
        singles.push({ index, sim });
      }
      group.push(sim);
    } else {
      singles.push({ index, sim });
    }
  });

  const seen = new Set<string>();
  for (const { sim } of singles) {
    if (sim.batch_id) {
      if (seen.has(sim.batch_id)) continue;
      seen.add(sim.batch_id);
      entries.push({ type: 'batch', batchId: sim.batch_id, sims: batchMap.get(sim.batch_id)! });
    } else {
      entries.push({ type: 'single', sim });
    }
  }
  return entries;
}

function BatchGroup({ entry }: { entry: Extract<HistoryEntry, { type: 'batch' }> }) {
  const { t } = useLanguage();
  const first = entry.sims[0];
  const simType = ({
    quick: t('simType.quickSim'),
    top_gear: t('simType.topGear'),
    droptimizer: t('simType.dropFinder'),
  } as Record<string, string>)[first?.sim_type] || first?.sim_type || 'Sim';

  return (
    <div className="border-b border-outline-variant/10">
      <div className="bg-surface-container/50 px-6 py-3 flex items-center justify-between border-b border-outline-variant/5">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase text-primary tracking-widest">
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
          {simType} &middot; {t('history.scenariosCount', { count: entry.sims.length })}
          {first?.player_name && (
            <span className="text-on-surface-variant opacity-60 normal-case tracking-normal ml-2">
              {first.player_name}
            </span>
          )}
        </span>
        <span className="text-[10px] text-on-surface-variant opacity-60">
          {timeAgo(first?.created_at, t)}
        </span>
      </div>
      {entry.sims.map((sim) => (
        <SimRow key={sim.id} sim={sim} />
      ))}
    </div>
  );
}

/* ── Table ────────────────────────────────────────────────── */

function SimList({ sims }: { sims: JobSummary[] }) {
  const { t } = useLanguage();
  const entries = groupByBatch(sims);

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 shadow-2xl">
      <div className="grid grid-cols-12 px-6 py-4 bg-surface-container-low font-headline text-[10px] uppercase tracking-widest text-on-surface-variant font-bold border-b border-outline-variant/10">
        <div className="col-span-1"></div>
        <div className="col-span-3">{t('history.simulation')}</div>
        <div className="col-span-2 text-center">{t('history.type')}</div>
        <div className="col-span-2 text-right">{t('history.dpsOutcome')}</div>
        <div className="col-span-2 text-center">{t('history.fightStyle')}</div>
        <div className="col-span-2 text-right">{t('history.time')}</div>
      </div>
      {entries.map((entry) => {
        if (entry.type === 'single') {
          return (
            <div key={entry.sim.id} className="border-b border-outline-variant/10">
              <SimRow sim={entry.sim} />
            </div>
          );
        }
        return <BatchGroup key={entry.batchId} entry={entry} />;
      })}
    </div>
  );
}

/* ── Stats Overview ──────────────────────────────────────── */

function StatsOverview({ sims }: { sims: JobSummary[] }) {
  const { t } = useLanguage();
  const totalSims = sims.length;
  const completedSims = sims.filter((s) => s.status === 'done');
  const completionRate = totalSims > 0 ? (completedSims.length / totalSims) * 100 : 0;
  const bestDps = Math.max(0, ...completedSims.map((s) => s.dps ?? 0));
  const uniqueCharacters = new Set(
    sims.filter((s) => s.player_name).map((s) => `${s.player_name}-${s.realm ?? ''}`)
  ).size;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
      <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/10 shadow-xl">
        <p className="text-xs uppercase font-headline tracking-widest text-on-surface-variant mb-1">
          {t('history.totalSims')}
        </p>
        <p className="text-3xl font-black text-primary font-headline">
          {totalSims.toLocaleString()}
        </p>
        <p className="text-[10px] text-outline mt-2">
          {t('history.completionRate', { count: completedSims.length, pct: completionRate.toFixed(0) })}
        </p>
      </div>
      <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/10 shadow-xl">
        <p className="text-xs uppercase font-headline tracking-widest text-on-surface-variant mb-1">
          {t('history.characters')}
        </p>
        <p className="text-3xl font-black text-tertiary font-headline">
          {uniqueCharacters}
        </p>
        <p className="text-[10px] text-outline mt-2">
          {t('history.uniqueCharacters')}
        </p>
      </div>
      <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/10 shadow-xl">
        <p className="text-xs uppercase font-headline tracking-widest text-on-surface-variant mb-1">
          {t('history.bestDps')}
        </p>
        <p className="text-3xl font-black text-on-surface font-headline">
          {bestDps > 0 ? formatDps(bestDps) : '—'}
        </p>
        <p className="text-[10px] text-outline mt-2">
          {t('history.highestResult')}
        </p>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */

export default function HistoryPage() {
  const { t } = useLanguage();
  const { simcInput } = useSimContext();
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [sims, setSims] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [character, setCharacter] = useState<{ name: string; realm: string } | null>(null);

  useEffect(() => {
    setIsDesktop(!!window.electronAPI);
  }, []);

  useEffect(() => {
    if (isDesktop !== true) return;
    setLoading(true);
    fetch(`${API_URL}/api/sims`)
      .then((r) => r.json())
      .then((data) => setSims(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isDesktop]);

  useEffect(() => {
    if (isDesktop !== false) return;
    let char = extractCharacter(simcInput);
    if (!char) {
      try {
        const stored = localStorage.getItem('simhammer_last_character');
        if (stored) char = JSON.parse(stored);
      } catch {}
    }
    setCharacter(char);
    if (!char) {
      setSims([]);
      return;
    }
    setLoading(true);
    fetch(
      `${API_URL}/api/sims?player=${encodeURIComponent(char.name)}&realm=${encodeURIComponent(char.realm)}`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSims(data))
      .catch(() => setSims([]))
      .finally(() => setLoading(false));
  }, [isDesktop, simcInput]);

  function handleExportCsv() {
    const header =
      'id,status,sim_type,created_at,player_name,player_class,realm,dps,fight_style,iterations\n';
    const rows = sims
      .map((s) =>
        [
          s.id,
          s.status,
          s.sim_type,
          s.created_at,
          s.player_name ?? '',
          s.player_class ?? '',
          s.realm ?? '',
          s.dps ?? '',
          s.fight_style,
          s.iterations,
        ].join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'simhammer-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isDesktop === null) return null;

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-surface-container-highest border-t-primary" />
        <p className="mt-4 text-sm text-on-surface-variant">{t('history.loading')}</p>
      </div>
    );
  }

  if (!isDesktop && !character) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-on-surface-variant/60">
          {t('history.pasteExportWeb')}
        </p>
      </div>
    );
  }

  if (sims.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-on-surface-variant/60">
          {character
            ? t('history.noCharacterSims', { name: character.name, realm: character.realm })
            : t('history.noSimulations')}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-on-surface">
            {t('history.title')}
          </h1>
          <p className="text-on-surface-variant max-w-xl mt-2">
            {t('history.subtitle')}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setSims([])}
            className="px-4 py-2 bg-surface-container-high border border-outline-variant/20 rounded-lg text-xs font-bold uppercase tracking-widest text-[#d2c5b0] hover:text-primary transition-all"
          >
            {t('history.clearHistory')}
          </button>
          <button
            onClick={handleExportCsv}
            className="px-6 py-2 bg-primary-container text-on-primary rounded-lg text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t('history.exportCsv')}
          </button>
        </div>
      </div>

      {/* Bento Stats Overview */}
      <StatsOverview sims={sims} />

      {/* History Table */}
      <SimList sims={sims} />
    </div>
  );
}
