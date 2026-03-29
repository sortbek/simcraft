'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { parseTalentLoadouts } from '../lib/types';
import { decodeHeader } from '../lib/talentDecode';
import TalentTree from './TalentTree';

type ViewMode = 'hidden' | 'view' | 'edit';

export default function TalentPicker() {
  const { simcInput, selectedTalent, setSelectedTalent } = useSimContext();
  const [viewMode, setViewMode] = useState<ViewMode>('hidden');
  const [selectedLoadoutIdx, setSelectedLoadoutIdx] = useState(() => {
    // Find the active loadout index on first render
    const loadouts = parseTalentLoadouts(simcInput);
    const idx = loadouts.findIndex((l) => l.isActive);
    return idx >= 0 ? idx : 0;
  });

  const loadouts = useMemo(() => parseTalentLoadouts(simcInput), [simcInput]);

  // Always keep selectedTalent in sync with the selected loadout.
  // The backend handles normalization (free nodes, subtree selectors).
  const currentTalent = loadouts[selectedLoadoutIdx]?.talentString || '';

  useEffect(() => {
    if (loadouts.length === 0) {
      if (selectedTalent) setSelectedTalent('');
      return;
    }
    // Keep selectedTalent in sync with current loadout
    if (currentTalent && selectedTalent !== currentTalent) {
      setSelectedTalent(currentTalent);
    }
  }, [currentTalent, loadouts.length, selectedTalent, setSelectedTalent]);

  // Extract specId for editor mode
  const specId = useMemo(() => {
    if (!currentTalent) return null;
    try {
      return decodeHeader(currentTalent).specId;
    } catch {
      return null;
    }
  }, [currentTalent]);

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
              setSelectedTalent(loadouts[idx].talentString);
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
      {viewMode === 'view' && currentTalent && <TalentTree talentString={currentTalent} />}
      {viewMode === 'edit' && specId && (
        <TalentTree
          talentString={currentTalent}
          editable
          specId={specId}
          onTalentStringChange={handleEditorChange}
        />
      )}
    </div>
  );
}
