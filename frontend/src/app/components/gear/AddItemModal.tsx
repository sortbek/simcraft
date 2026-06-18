'use client';

import { useState } from 'react';
import LootBrowser from '../loot/LootBrowser';
import { buildItemLevelOptions, dropPayloadAtIlvl } from '../loot/itemLevelOptions';
import { dropUid, type DropItem, type UpgradeTracks } from '../loot/types';
import { postJson } from '../../lib/api';
import type { ResolvedItem } from '../../lib/types';

export interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  simcInput: string;
  /** Called with the backend-resolved items to merge into Top Gear state. */
  onItemsResolved: (items: ResolvedItem[]) => void;
}

export default function AddItemModal({ open, onClose, simcInput, onItemsResolved }: AddItemModalProps) {
  const [ilvlByUid, setIlvlByUid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function renderLevel(item: DropItem, tracks: UpgradeTracks) {
    const options = buildItemLevelOptions(item, tracks);
    const uid = dropUid(item);
    const value = ilvlByUid[uid] ?? options[0]?.ilvl;
    return (
      <select
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const ilvl = Number(e.target.value);
          setIlvlByUid((prev) => ({ ...prev, [uid]: ilvl }));
        }}
        className="rounded border border-outline-variant/30 bg-surface-container px-1.5 py-0.5 text-xs text-on-surface focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.ilvl} value={opt.ilvl}>
            {opt.ilvl}
          </option>
        ))}
      </select>
    );
  }

  async function handleAdd(selectedDrops: DropItem[], upgradeTracks: UpgradeTracks) {
    setError(null);
    setLoading(true);
    try {
      const dropItems = selectedDrops.map((item) => {
        const uid = dropUid(item);
        const options = buildItemLevelOptions(item, upgradeTracks);
        const chosenIlvl = ilvlByUid[uid];
        const option = (chosenIlvl != null ? options.find((o) => o.ilvl === chosenIlvl) : null) ?? options[0];
        return dropPayloadAtIlvl(item, option);
      });

      const res = await postJson<{ items: ResolvedItem[] }>('/api/top-gear/resolve-drops', {
        simc_input: simcInput,
        drop_items: dropItems,
      });
      onItemsResolved(res.items);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve items');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline-variant/20 px-6 py-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-on-surface">
            Add Items
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* Body: scrollable LootBrowser */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <LootBrowser
              hideDifficultyControls
              renderLevel={renderLevel}
              footer={(state) => (
                <div className="mt-4 flex flex-col gap-2">
                  {error && (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
                      {error}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-xs text-on-surface-variant">
                      {state.selectedDrops.length} item{state.selectedDrops.length !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      type="button"
                      disabled={!state.hasSelection || loading}
                      onClick={() => handleAdd(state.selectedDrops, state.upgradeTracks)}
                      className="rounded-lg bg-gold px-5 py-2 text-sm font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90"
                    >
                      {loading ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
