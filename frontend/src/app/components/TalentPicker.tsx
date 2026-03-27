'use client';

import { useEffect, useMemo } from 'react';
import { useSimContext } from './SimContext';
import { parseTalentLoadouts } from '../lib/types';

export default function TalentPicker() {
  const { simcInput, selectedTalent, setSelectedTalent } = useSimContext();

  const loadouts = useMemo(() => parseTalentLoadouts(simcInput), [simcInput]);

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

  if (loadouts.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Talents</span>
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
    </div>
  );
}
