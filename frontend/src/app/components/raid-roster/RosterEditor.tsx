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
import { StatusBadge } from './StatusBadge';
import Button from '../ui/Button';

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
    <div className="flex min-h-[62px] items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-overlay/[0.015]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-on-surface">
          {member.name}
          {member.item_level > 0 && (
            <span className="ml-1.5 rounded-[5px] bg-surface-container-high px-1.5 py-0.5 font-headline text-[11px] font-extrabold text-on-surface-variant">
              ilvl {member.item_level}
            </span>
          )}
          <span className="font-normal text-outline"> - {member.realm}</span>
        </div>
        {(member.class || member.spec) && (
          <div className="truncate text-[12px] text-outline">
            {[member.spec, member.class].filter(Boolean).join(' ')}
          </div>
        )}
      </div>
      <StatusBadge status={member.armory_status} />
      <Button
        onClick={handleCopy}
        disabled={!member.source_simc}
        title={copied ? 'Copied!' : 'Copy SimC'}
        aria-label={`Copy SimC for ${member.name}`}
        variant="quiet"
        size="sm"
        className="shrink-0"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        onClick={handleQuickSim}
        disabled={!canSim || simming}
        title="Quick sim this player"
        aria-label={`Quick sim ${member.name}`}
        variant="quiet"
        size="sm"
        className="shrink-0"
      >
        {simming ? 'Simming…' : 'Quick Sim'}
      </Button>
      <Button
        onClick={handleRefetch}
        disabled={refetching}
        title="Re-fetch from armory"
        aria-label={`Re-fetch ${member.name} from armory`}
        variant="quiet"
        size="sm"
        className="shrink-0"
      >
        {refetching ? '…' : 'Re-fetch'}
      </Button>
      <button
        onClick={() => onRemove(member.id)}
        className="shrink-0 text-base text-fg-4 transition-colors hover:text-negative"
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
      deleteMember(roster.id, memberId)
        .catch((e) => console.error('Delete member failed', e))
        .finally(refreshMembers);
    },
    [roster.id, refreshMembers]
  );

  // Only picks the button label — the backend decides which import path runs. A
  // `Name-Realm` line can never contain `="`, so this cannot misread one.
  const profileCount = (text.match(/^[a-z_]+="/gm) ?? []).length;

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
        <label className="label-text">Add members</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            'Playername-Realm, one per line, e.g.\nJaina-Tarren Mill\n\n…or paste SimC strings to import gear directly.'
          }
          className="input-field h-32 resize-y font-mono text-[13px] leading-relaxed"
        />
        <Button variant="solid" onClick={handleFetch} disabled={fetching || !text.trim()}>
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
          {fetching
            ? 'Importing…'
            : profileCount > 0
              ? `Import ${profileCount} profile${profileCount === 1 ? '' : 's'}`
              : 'Fetch gear from armory'}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="lbl">Members ({members.length})</div>
          <Button
            variant="quiet"
            onClick={handleRefreshAll}
            disabled={members.length === 0 || refreshingAll}
            title="Re-fetch all members from armory"
            aria-label="Refresh all members from armory"
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
          </Button>
        </div>
        {members.length === 0 ? (
          <p className="py-4 text-sm text-outline">
            No members yet. Paste characters above and fetch their gear.
          </p>
        ) : (
          <div className="card divide-y divide-line/[0.06] overflow-hidden">
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
