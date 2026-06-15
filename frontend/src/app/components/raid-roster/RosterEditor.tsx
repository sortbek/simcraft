'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMembers,
  importMembers,
  deleteMember,
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

export default function RosterEditor({ roster }: { roster: Roster }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [text, setText] = useState('');
  const [fetching, setFetching] = useState(false);

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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Add members
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'One per line, e.g.\nCharname-Realm\nAnother-Realm'}
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
        <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Members ({members.length})
        </div>
        {members.length === 0 ? (
          <p className="py-4 text-sm text-on-surface-variant/60">
            No members yet. Paste characters above and fetch their gear.
          </p>
        ) : (
          <div className="divide-y divide-outline-variant/10 overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-on-surface">
                    {member.name}
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
                  onClick={() => handleRemove(member.id)}
                  className="shrink-0 text-base text-on-surface-variant/30 transition-colors hover:text-red-400"
                  aria-label={`Remove ${member.name}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
