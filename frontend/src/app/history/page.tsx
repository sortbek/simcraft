'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_URL } from '../lib/api';
import { useSimContext } from '../components/SimContext';

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

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-emerald-500',
  running: 'bg-amber-500',
  failed: 'bg-red-500',
  pending: 'bg-zinc-500',
  cancelled: 'bg-zinc-600',
};

const FIGHT_STYLE_SHORT: Record<string, string> = {
  Patchwerk: 'Patch',
  HecticAddCleave: 'Cleave',
  LightMovement: 'Move',
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

function SimRow({ sim, compact }: { sim: JobSummary; compact?: boolean }) {
  return (
    <Link
      href={`/sim/${sim.id}`}
      className={`flex items-center gap-3 transition-colors hover:bg-white/[0.03] ${compact ? 'px-4 py-2' : 'px-5 py-3'}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[sim.status] || STATUS_COLORS.pending}`}
      />
      {!compact && (
        <span className="shrink-0 rounded-md bg-gold/[0.08] px-2 py-0.5 text-[10px] font-medium text-gold">
          {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {sim.player_name ? (
          <span className={`block truncate text-zinc-200 ${compact ? 'text-xs' : 'text-sm'}`}>
            {sim.player_name}
            {sim.player_class && <span className="ml-1.5 text-zinc-500">{sim.player_class}</span>}
          </span>
        ) : sim.status === 'failed' ? (
          <span className={`block truncate text-red-400/80 ${compact ? 'text-xs' : 'text-sm'}`}>
            {sim.error_message || 'Failed'}
          </span>
        ) : (
          <span className={`block truncate text-zinc-500 ${compact ? 'text-xs' : 'text-sm'}`}>
            {sim.status === 'running' ? 'Simulating...' : 'Pending...'}
          </span>
        )}
      </div>
      <span
        className={`shrink-0 text-right font-mono tabular-nums text-zinc-200 ${compact ? 'w-16 text-xs' : 'w-20 text-sm'}`}
      >
        {sim.dps ? Math.round(sim.dps).toLocaleString() : '—'}
      </span>
      <span
        className={`hidden shrink-0 text-right text-zinc-500 sm:block ${compact ? 'w-12 text-[10px]' : 'w-20 text-[11px]'}`}
      >
        {FIGHT_STYLE_SHORT[sim.fight_style] || sim.fight_style}
      </span>
      <span
        className={`shrink-0 text-right text-zinc-600 ${compact ? 'w-12 text-[10px]' : 'w-14 text-[11px]'}`}
      >
        {timeAgo(sim.created_at)}
      </span>
    </Link>
  );
}

type HistoryEntry =
  | { type: 'single'; sim: JobSummary }
  | { type: 'batch'; batchId: string; sims: JobSummary[] };

function groupByBatch(sims: JobSummary[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batchMap = new Map<string, JobSummary[]>();
  const singles: { index: number; sim: JobSummary }[] = [];

  // First pass: group batched sims
  sims.forEach((sim, index) => {
    if (sim.batch_id) {
      let group = batchMap.get(sim.batch_id);
      if (!group) {
        group = [];
        batchMap.set(sim.batch_id, group);
        // Reserve position of first item in batch
        singles.push({ index, sim }); // placeholder
      }
      group.push(sim);
    } else {
      singles.push({ index, sim });
    }
  });

  // Build output preserving original order
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
  const first = entry.sims[0];
  const simType = SIM_TYPE_LABELS[first?.sim_type] || first?.sim_type || 'Sim';
  const bestDps = Math.max(...entry.sims.map((s) => s.dps ?? 0));

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Batch header */}
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gold/10">
          <svg
            className="h-3 w-3 text-gold"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-zinc-200">
            {simType} &middot; {entry.sims.length} Scenarios
          </span>
          {first?.player_name && (
            <span className="ml-2 text-xs text-zinc-500">{first.player_name}</span>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-gold/[0.08] px-2 py-0.5 text-[10px] font-medium text-gold">
          {simType}
        </span>
        {bestDps > 0 && (
          <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-200">
            {Math.round(bestDps).toLocaleString()}
          </span>
        )}
        <span className="w-14 shrink-0 text-right text-[11px] text-zinc-600">
          {timeAgo(first?.created_at)}
        </span>
      </div>
      {/* Batch items — indented */}
      <div className="border-t border-border/50 bg-surface-2/50 pl-4">
        <div className="divide-y divide-border/30">
          {entry.sims.map((sim) => (
            <SimRow key={sim.id} sim={sim} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

function SimList({ sims }: { sims: JobSummary[] }) {
  const entries = groupByBatch(sims);

  return (
    <div className="card overflow-hidden">
      {entries.map((entry) => {
        if (entry.type === 'single') {
          return (
            <div key={entry.sim.id} className="border-b border-border last:border-b-0">
              <SimRow sim={entry.sim} />
            </div>
          );
        }
        return <BatchGroup key={entry.batchId} entry={entry} />;
      })}
    </div>
  );
}

export default function HistoryPage() {
  const { simcInput } = useSimContext();
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [sims, setSims] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [character, setCharacter] = useState<{ name: string; realm: string } | null>(null);

  useEffect(() => {
    setIsDesktop(!!window.electronAPI);
  }, []);

  // Desktop: fetch all sims
  useEffect(() => {
    if (isDesktop !== true) return;
    setLoading(true);
    fetch(`${API_URL}/api/sims`)
      .then((r) => r.json())
      .then((data) => setSims(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isDesktop]);

  // Web: extract character from simc input (or localStorage fallback) and fetch filtered history
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

  if (isDesktop === null) return null;

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Loading history...</p>
      </div>
    );
  }

  // Web without simc input pasted
  if (!isDesktop && !character) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">
          Paste your SimC addon export to see your character&apos;s sim history.
        </p>
      </div>
    );
  }

  if (sims.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">
          {character
            ? `No simulations found for ${character.name} on ${character.realm}.`
            : 'No simulations yet.'}
        </p>
      </div>
    );
  }

  return <SimList sims={sims} />;
}
