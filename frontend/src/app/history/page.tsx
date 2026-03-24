"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { useSimContext } from "../components/SimContext";

interface JobSummary {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  sim_type: string;
  created_at: string;
  fight_style: string;
  iterations: number;
  error_message: string | null;
  player_name: string | null;
  player_class: string | null;
  realm: string | null;
  dps: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  done: "bg-green-500",
  running: "bg-yellow-500",
  failed: "bg-red-500",
  pending: "bg-gray-500",
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: "Quick Sim",
  top_gear: "Top Gear",
  droptimizer: "Drop Finder",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function extractCharacter(simcInput: string): { name: string; realm: string } | null {
  let name = "";
  let realm = "";
  for (const line of simcInput.split("\n")) {
    const trimmed = line.trim();
    if (!name) {
      const match = trimmed.match(
        /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)"/
      );
      if (match) name = match[1];
    }
    if (!realm && trimmed.startsWith("server=")) {
      realm = trimmed.slice(7);
    }
    if (name && realm) break;
  }
  if (name && realm) {
    try { localStorage.setItem("simhammer_last_character", JSON.stringify({ name, realm })); } catch {}
    return { name, realm };
  }
  return null;
}

function SimList({ sims }: { sims: JobSummary[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="divide-y divide-border">
        {sims.map((sim) => (
          <Link
            key={sim.id}
            href={`/sim/${sim.id}`}
            className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[sim.status] || STATUS_COLORS.pending}`} />
            <span className="text-[11px] font-medium text-gold bg-gold/10 px-2 py-0.5 rounded shrink-0">
              {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
            </span>
            <div className="flex-1 min-w-0">
              {sim.player_name ? (
                <span className="text-sm text-white truncate block">
                  {sim.player_name}
                  {sim.player_class && (
                    <span className="text-muted ml-1.5">{sim.player_class}</span>
                  )}
                </span>
              ) : sim.status === "failed" ? (
                <span className="text-sm text-red-400 truncate block">
                  {sim.error_message || "Failed"}
                </span>
              ) : (
                <span className="text-sm text-muted truncate block">
                  {sim.status === "running" ? "Simulating..." : "Pending..."}
                </span>
              )}
            </div>
            <span className="text-sm font-mono tabular-nums text-white w-20 text-right shrink-0">
              {sim.dps ? Math.round(sim.dps).toLocaleString() : "—"}
            </span>
            <span className="text-[11px] text-muted w-20 text-right shrink-0 hidden sm:block">
              {sim.fight_style}
            </span>
            <span className="text-[11px] text-gray-600 w-14 text-right shrink-0">
              {timeAgo(sim.created_at)}
            </span>
          </Link>
        ))}
      </div>
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
        const stored = localStorage.getItem("simhammer_last_character");
        if (stored) char = JSON.parse(stored);
      } catch {}
    }
    setCharacter(char);
    if (!char) { setSims([]); return; }
    setLoading(true);
    fetch(`${API_URL}/api/sims?player=${encodeURIComponent(char.name)}&realm=${encodeURIComponent(char.realm)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSims(data))
      .catch(() => setSims([]))
      .finally(() => setLoading(false));
  }, [isDesktop, simcInput]);

  if (isDesktop === null) return null;

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">Loading history...</p>
      </div>
    );
  }

  // Web without simc input pasted
  if (!isDesktop && !character) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">Paste your SimC addon export to see your character&apos;s sim history.</p>
      </div>
    );
  }

  if (sims.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">
          {character ? `No simulations found for ${character.name} on ${character.realm}.` : "No simulations yet."}
        </p>
      </div>
    );
  }

  return <SimList sims={sims} />;
}
