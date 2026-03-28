'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { parseTalentLoadouts } from '../lib/types';
import TalentTree from './TalentTree';

export default function TalentPicker() {
  const { simcInput, selectedTalent, setSelectedTalent } = useSimContext();
  const [showTree, setShowTree] = useState(false);

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

  // Reset selection when input changes and current selection is no longer valid
  useEffect(() => {
    if (loadouts.length === 0) {
      if (selectedTalent) setSelectedTalent('');
      return;
    }
    const stillValid = loadouts.some((l) => l.talentString === selectedTalent);
    if (!stillValid) {
      const active = loadouts.find((l) => l.isActive);
      setSelectedTalent(active?.talentString || loadouts[0].talentString);
    }
  }, [loadouts, selectedTalent, setSelectedTalent]);

  if (loadouts.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Talents</span>
        {loadouts.length >= 2 && (
          <select
            value={selectedTalent}
            onChange={(e) => setSelectedTalent(e.target.value)}
            className="input-field !w-auto !px-2.5 !py-1.5 !text-xs"
          >
            {loadouts.map((l, i) => (
              <option key={`${l.name}-${i}`} value={l.talentString}>
                {l.name}
                {l.isActive ? ' (equipped)' : ''}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowTree((v) => !v)}
          className="text-[11px] text-muted transition-colors hover:text-white"
        >
          {showTree ? 'Hide tree' : 'Show tree'}
        </button>
      </div>
      {showTree && activeTalent && <TalentTree talentString={activeTalent} />}
    </div>
  );
}
