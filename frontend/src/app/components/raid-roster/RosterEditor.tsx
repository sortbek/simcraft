'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMembers,
  importMembers,
  deleteMember,
  refreshRoster,
  refreshMember,
  startQuickSim,
  type Roster,
  type RosterMember,
} from '../../lib/rosters';

const STATUS_STYLES: Record<string, { label: string; className: string; title?: string }> = {
  ok: {
    label: 'OK',
    className: 'border-green-400/30 bg-green-400/10 text-green-400',
  },
  pending: {
    label: 'Pending',
    className: 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant',
  },
  not_found: {
    label: 'Not found',
    className: 'border-red-500/30 bg-red-500/10 text-red-400',
    title: 'Character could not be found on the armory for this region.',
  },
  armory_failed: {
    label: 'Failed',
    className: 'border-red-500/30 bg-red-500/10 text-red-400',
    title: 'Fetching or converting this character from the armory failed.',
  },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    label: status || 'Unknown',
    className: 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant',
  };
  return (
    <span
      title={style.title}
      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function MemberRow({
  member,
  rosterId,
  onMembersChange,
  onRemove,
}: {
  member: RosterMember;
  rosterId: string;
  onMembersChange: (members: RosterMember[]) => void;
  onRemove: (memberId: string) => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [simming, setSimming] = useState(false);
  const [refetching, setRefetching] = useState(false);

  const canSim = member.armory_status === 'ok' && !!member.source_simc;

  const handleCopy = useCallback(() => {
    if (!member.source_simc) return;
    navigator.clipboard.writeText(member.source_simc);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [member.source_simc]);

  const handleQuickSim = useCallback(async () => {
    if (!canSim) return;
    setSimming(true);
    const res = await startQuickSim(member.source_simc);
    if (res) {
      router.push('/sim/' + res.id);
    } else {
      setSimming(false);
    }
  }, [canSim, member.source_simc, router]);

  const handleRefetch = useCallback(async () => {
    setRefetching(true);
    try {
      const res = await refreshMember(rosterId, member.id);
      if (res.length) onMembersChange(res);
    } finally {
      setRefetching(false);
    }
  }, [rosterId, member.id, onMembersChange]);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-on-surface">
          {member.name}
          {member.item_level > 0 && (
            <span className="ml-1.5 rounded bg-surface-container-high px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant">
              ilvl {member.item_level}
            </span>
          )}
          <span className="text-on-surface-variant/60"> - {member.realm}</span>
        </div>
        {(member.class || member.spec) && (
          <div className="truncate text-[12px] text-on-surface-variant/60">
            {[member.spec, member.class].filter(Boolean).join(' ')}
          </div>
        )}
      </div>
      <StatusBadge status={member.armory_status} />
      <button
        onClick={handleCopy}
        disabled={!member.source_simc}
        title={copied ? 'Copied!' : 'Copy SimC'}
        aria-label={`Copy SimC for ${member.name}`}
        className="shrink-0 rounded-md border border-outline-variant/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-30"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        onClick={handleQuickSim}
        disabled={!canSim || simming}
        title="Quick sim this player"
        aria-label={`Quick sim ${member.name}`}
        className="shrink-0 rounded-md border border-outline-variant/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-30"
      >
        {simming ? 'Simming…' : 'Quick Sim'}
      </button>
      <button
        onClick={handleRefetch}
        disabled={refetching}
        title="Re-fetch from armory"
        aria-label={`Re-fetch ${member.name} from armory`}
        className="shrink-0 rounded-md border border-outline-variant/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-30"
      >
        {refetching ? '…' : 'Re-fetch'}
      </button>
      <button
        onClick={() => onRemove(member.id)}
        className="shrink-0 text-base text-on-surface-variant/30 transition-colors hover:text-red-400"
        aria-label={`Remove ${member.name}`}
      >
        &times;
      </button>
    </div>
  );
}

export default function RosterEditor({ roster }: { roster: Roster }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [text, setText] = useState('');
  const [fetching, setFetching] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const refreshMembers = useCallback(() => {
    getMembers(roster.id).then(setMembers);
  }, [roster.id]);

  useEffect(() => {
    refreshMembers();
  }, [refreshMembers]);

  const handleFetch = useCallback(async () => {
    if (!text.trim()) return;
    setFetching(true);
    try {
      const result = await importMembers(roster.id, text);
      setMembers(result);
    } finally {
      setFetching(false);
    }
  }, [roster.id, text]);

  const handleRemove = useCallback(
    (memberId: string) => {
      deleteMember(roster.id, memberId).then(refreshMembers);
    },
    [roster.id, refreshMembers]
  );

  const handleRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    try {
      const res = await refreshRoster(roster.id);
      if (res.length) setMembers(res);
    } finally {
      setRefreshingAll(false);
    }
  }, [roster.id]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Add members
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'One per line, e.g.\nRealm-Playername\nTarren Mill-Jaina'}
          className="h-32 w-full resize-y rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 font-mono text-[13px] leading-relaxed text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          onClick={handleFetch}
          disabled={fetching || !text.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold uppercase tracking-wider text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fetching && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {fetching ? 'Fetching…' : 'Fetch gear from armory'}
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            Members ({members.length})
          </div>
          <button
            onClick={handleRefreshAll}
            disabled={members.length === 0 || refreshingAll}
            title="Re-fetch all members from armory"
            aria-label="Refresh all members from armory"
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/10 px-3 py-1.5 font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            {refreshingAll && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {refreshingAll ? 'Refreshing…' : 'Refresh from armory'}
          </button>
        </div>
        {members.length === 0 ? (
          <p className="py-4 text-sm text-on-surface-variant/60">
            No members yet. Paste characters above and fetch their gear.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/10 overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                rosterId={roster.id}
                onMembersChange={setMembers}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
