"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";

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
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HistoryPage() {
  const [sims, setSims] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/sims`)
      .then((r) => r.json())
      .then((data) => setSims(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">Loading history...</p>
      </div>
    );
  }

  if (sims.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">No simulations yet. Run your first sim to see results here.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-xs font-medium text-muted uppercase tracking-widest">Recent Simulations</h3>
      </div>
      <div className="divide-y divide-border">
        {sims.map((sim) => (
          <Link
            key={sim.id}
            href={`/sim/${sim.id}`}
            className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors"
          >
            {/* Status dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[sim.status] || STATUS_COLORS.pending}`} />

            {/* Sim type badge */}
            <span className="text-[11px] font-medium text-gold bg-gold/10 px-2 py-0.5 rounded shrink-0">
              {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
            </span>

            {/* Character info */}
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

            {/* DPS */}
            <span className="text-sm font-mono tabular-nums text-white w-20 text-right shrink-0">
              {sim.dps ? Math.round(sim.dps).toLocaleString() : "—"}
            </span>

            {/* Fight style */}
            <span className="text-[11px] text-muted w-20 text-right shrink-0 hidden sm:block">
              {sim.fight_style}
            </span>

            {/* Time */}
            <span className="text-[11px] text-gray-600 w-14 text-right shrink-0">
              {timeAgo(sim.created_at)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
