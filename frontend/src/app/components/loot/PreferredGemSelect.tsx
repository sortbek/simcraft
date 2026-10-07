'use client';

import { useEffect, useState } from 'react';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import { groupGemsByColor, statLabel, type GemOption } from '../gear/itemOptions';
import { useLanguage } from '../../lib/i18n';
import Select from './Select';

/** Gems the drop finder offers, grouped the way the gear page groups them. */
export function useGemOptions(): GemOption[] {
  const [gems, setGems] = useState<GemOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchJsonOr<GemOption[]>(apiUrl('/api/gems?expansion=11'), []).then((all) => {
      if (!cancelled) setGems(groupGemsByColor(all).flatMap((group) => group.gems));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return gems;
}

interface PreferredGemSelectProps {
  /** null = fall back to the player's most-used equipped gem. */
  value: number | null;
  onChange: (value: number | null) => void;
  gems: GemOption[];
}

/** Which gem fills sockets the equipped item in that slot does not already
 *  cover. It never displaces a gem the player already wears. */
export default function PreferredGemSelect({ value, onChange, gems }: PreferredGemSelectProps) {
  const { t } = useLanguage();
  const options = [
    { value: null as number | null, label: t('dropFinder.preferredGemAuto') },
    ...gems
      .filter((gem) => gem.itemId)
      .map((gem) => ({
        value: gem.itemId as number | null,
        label: gem.itemName ?? gem.displayName,
        sublabel: gem.stats?.map(statLabel).join(', '),
      })),
  ];
  return <Select value={value} options={options} onChange={onChange} />;
}
