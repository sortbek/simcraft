'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRosters, createRoster, deleteRoster, type Roster } from '../lib/rosters';
import RosterEditor from '../components/raid-roster/RosterEditor';
import RosterRunPanel from '../components/raid-roster/RosterRunPanel';
import RosterHistory from '../components/raid-roster/RosterHistory';
import { REGIONS } from '../lib/regions';
import { useLanguage } from '../lib/i18n';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';

export default function RaidRosterPage() {
  const { t } = useLanguage();
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
      try {
        await deleteRoster(id);
        setSelectedId((cur) => (cur === id ? null : cur));
      } catch (e) {
        console.error('Delete roster failed', e);
      } finally {
        // Re-sync either way: on failure the row must reappear, not look deleted.
        refreshRosters();
      }
    },
    [refreshRosters]
  );

  const selectedRoster = rosters.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title="Raid Roster"
        subtitle={
          <>Build and save a raid roster, then pull each member&apos;s gear from the armory.</>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <form onSubmit={handleCreate} className="space-y-2">
            <label className="label-text">New roster</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Roster name..."
              className="input-field"
            />
            <div className="flex gap-2">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="sel w-auto uppercase"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                variant="solid"
                disabled={!name.trim()}
                className="h-[38px] flex-1"
              >
                Create
              </Button>
            </div>
          </form>

          <div className="space-y-1">
            <div className="label-text">Rosters ({rosters.length})</div>
            {rosters.length === 0 ? (
              <p className="py-2 text-sm text-outline">No rosters yet.</p>
            ) : (
              <div className="space-y-0.5">
                {rosters.map((r) => {
                  const isActive = r.id === selectedId;
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center justify-between rounded-[6px] border px-3 py-2 transition-colors ${
                        isActive
                          ? 'border-gold-edge bg-gold-tint'
                          : 'border-transparent hover:bg-surface-container-high'
                      }`}
                    >
                      <button
                        onClick={() => setSelectedId(r.id)}
                        className={`min-w-0 flex-1 text-left transition-colors ${
                          isActive ? 'text-gold' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <div className="truncate text-sm font-semibold">{r.name}</div>
                        <div className="lbl mt-1 truncate">{r.region}</div>
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="ml-2 shrink-0 text-base text-fg-4 transition-colors hover:text-negative"
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
              <ToggleButtonGroup<'manage' | 'report' | 'history'>
                value={tab}
                onChange={setTab}
                options={[
                  { key: 'manage', label: 'Manage Roster' },
                  { key: 'report', label: 'Loot Report' },
                  { key: 'history', label: 'History' },
                ]}
              />
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
            <div className="rounded-[10px] border border-dashed border-line/[0.11] px-6 py-12 text-center text-sm text-outline">
              Select or create a roster to manage its members.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
