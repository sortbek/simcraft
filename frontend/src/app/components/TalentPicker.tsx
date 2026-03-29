'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { parseTalentLoadouts } from '../lib/types';
import { decodeHeader } from '../lib/talentDecode';
import { normalizeTalentString } from '../lib/talentEncode';
import { useTalentTree } from '../lib/useTalentTree';
import TalentTree from './TalentTree';

type ViewMode = 'hidden' | 'view' | 'edit';

export default function TalentPicker() {
  const { simcInput, selectedTalent, setSelectedTalent } = useSimContext();
  const [viewMode, setViewMode] = useState<ViewMode>('hidden');
  const [selectedLoadoutIdx, setSelectedLoadoutIdx] = useState(0);

  const loadouts = useMemo(() => parseTalentLoadouts(simcInput), [simcInput]);

  // Get the active talent string (even if there's only one loadout)
  const activeTalent = useMemo(() => {
    if (selectedTalent) return selectedTalent;
    if (loadouts.length > 0) {
      const active = loadouts.find((l) => l.isActive);
      return active?.talentString || loadouts[0].talentString;
    }
    return '';
  }, [selectedTalent, loadouts]);

  // Extract specId from the active talent string for editor mode
  const specId = useMemo(() => {
    if (!activeTalent) return null;
    try {
      return decodeHeader(activeTalent).specId;
    } catch {
      return null;
    }
  }, [activeTalent]);

  const tree = useTalentTree(specId);

  // Normalize talent strings (auto-grant free nodes that SimC requires)
  const normalize = useCallback(
    (s: string) => {
      if (!tree) return s;
      try {
        return normalizeTalentString(s, tree);
      } catch {
        return s;
      }
    },
    [tree],
  );

  // Ensure selectedTalent is always set and normalized.
  // Runs on mount, on input change, and when tree data loads.
  useEffect(() => {
    if (loadouts.length === 0) {
      if (selectedTalent) setSelectedTalent('');
      return;
    }

    // Determine which talent string should be active
    const currentLoadout = loadouts[selectedLoadoutIdx] ?? loadouts[0];
    const rawTalent = currentLoadout?.talentString || '';
    if (!rawTalent) return;

    // Normalize it (requires tree data; returns raw if tree isn't loaded yet)
    const normalized = normalize(rawTalent);

    // Set if not already matching
    if (selectedTalent !== normalized) {
      setSelectedTalent(normalized);
    }
  }, [loadouts, selectedLoadoutIdx, tree, normalize, selectedTalent, setSelectedTalent]);

  const handleEditorChange = useCallback(
    (s: string) => {
      setSelectedTalent(s);
    },
    [setSelectedTalent],
  );

  if (loadouts.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Talents</span>
        {loadouts.length >= 2 && (
          <select
            value={selectedLoadoutIdx}
            onChange={(e) => {
              const idx = Number(e.target.value);
              setSelectedLoadoutIdx(idx);
              setSelectedTalent(normalize(loadouts[idx].talentString));
              if (viewMode === 'edit') setViewMode('view');
            }}
            className="input-field !w-auto !px-2.5 !py-1.5 !text-xs"
          >
            {loadouts.map((l, i) => (
              <option key={`${l.name}-${i}`} value={i}>
                {l.name}
                {l.isActive ? ' (equipped)' : ''}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setViewMode((v) => (v === 'hidden' ? 'view' : 'hidden'))}
          className="text-[11px] text-muted transition-colors hover:text-white"
        >
          {viewMode !== 'hidden' ? 'Hide tree' : 'Show tree'}
        </button>
        {viewMode !== 'hidden' && (
          <button
            onClick={() => setViewMode((v) => (v === 'edit' ? 'view' : 'edit'))}
            className={`text-[11px] transition-colors ${
              viewMode === 'edit'
                ? 'font-medium text-gold'
                : 'text-muted hover:text-white'
            }`}
          >
            {viewMode === 'edit' ? 'Done editing' : 'Edit'}
          </button>
        )}
      </div>
      {viewMode === 'view' && activeTalent && <TalentTree talentString={activeTalent} />}
      {viewMode === 'edit' && specId && (
        <TalentTree
          talentString={activeTalent}
          editable
          specId={specId}
          onTalentStringChange={handleEditorChange}
        />
      )}
    </div>
  );
}
