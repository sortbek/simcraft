'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRosters,
  createRoster,
  deleteRoster,
  type Roster,
} from '../lib/rosters';
import RosterEditor from '../components/raid-roster/RosterEditor';
import RosterRunPanel from '../components/raid-roster/RosterRunPanel';
import RosterHistory from '../components/raid-roster/RosterHistory';

const REGIONS = ['eu', 'us', 'kr', 'tw'] as const;

export default function RaidRosterPage() {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState<string>('eu');
  const [tab, setTab] = useState<'manage' | 'report' | 'history'>('manage');

  const refreshRosters = useCallback(() => {
    return getRosters().then(setRosters);
  }, []);

  useEffect(() => {
    refreshRosters();
  }, [refreshRosters]);

  // Start on the Manage tab whenever the selected roster changes.
  useEffect(() => {
    setTab('manage');
  }, [selectedId]);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      const created = await createRoster(trimmed, region);
      if (created) {
        setName('');
        await refreshRosters();
        setSelectedId(created.id);
      }
    },
    [name, region, refreshRosters]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteRoster(id);
      setSelectedId((cur) => (cur === id ? null : cur));
      refreshRosters();
    },
    [refreshRosters]
  );

  const selectedRoster = rosters.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          Raid Roster
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">
          Build and save a raid roster, then pull each member&apos;s gear from the armory.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <form onSubmit={handleCreate} className="space-y-2">
            <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              New roster
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Roster name..."
              className="w-full rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <div className="flex gap-2">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm uppercase text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!name.trim()}
                className="flex-1 rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold uppercase tracking-wider text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>

          <div className="space-y-1">
            <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Rosters ({rosters.length})
            </div>
            {rosters.length === 0 ? (
              <p className="py-2 text-sm text-on-surface-variant/60">No rosters yet.</p>
            ) : (
              <div className="space-y-0.5">
                {rosters.map((r) => {
                  const isActive = r.id === selectedId;
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center justify-between rounded-md px-3 py-2 ${
                        isActive ? 'bg-primary-container/10' : 'hover:bg-surface-container'
                      }`}
                    >
                      <button
                        onClick={() => setSelectedId(r.id)}
                        className={`min-w-0 flex-1 text-left transition-colors ${
                          isActive ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="truncate text-[11px] uppercase text-on-surface-variant/50">
                          {r.region}
                        </div>
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="ml-2 shrink-0 text-base text-on-surface-variant/30 transition-colors hover:text-red-400"
                        aria-label={`Delete ${r.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div>
          {selectedRoster ? (
            <div className="space-y-4">
              <div className="flex gap-1 border-b border-outline-variant/10">
                {(
                  [
                    ['manage', 'Manage Roster'],
                    ['report', 'Loot Report'],
                    ['history', 'History'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`-mb-px border-b-2 px-4 py-2 font-headline text-xs font-bold uppercase tracking-wider transition-colors ${
                      tab === key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Both stay mounted (inactive hidden) so a running sim survives tab switches. */}
              <div className={tab === 'manage' ? '' : 'hidden'}>
                <RosterEditor key={selectedRoster.id} roster={selectedRoster} />
              </div>
              <div className={tab === 'report' ? '' : 'hidden'}>
                <RosterRunPanel key={`run-${selectedRoster.id}`} roster={selectedRoster} />
              </div>
              <div className={tab === 'history' ? '' : 'hidden'}>
                <RosterHistory key={`hist-${selectedRoster.id}`} roster={selectedRoster} />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-outline-variant/20 px-6 py-12 text-center text-sm text-on-surface-variant/60">
              Select or create a roster to manage its members.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
