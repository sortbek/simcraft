'use client';

import Select from './Select';
import { useLanguage } from '../../lib/i18n';
import type { CraftedEmbellishment } from '../../lib/types';

interface EmbellishmentSelectProps {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Season embellishment options (season-config `crafted_embellishments`). */
  options?: CraftedEmbellishment[];
}

export default function EmbellishmentSelect({
  value,
  onChange,
  options,
}: EmbellishmentSelectProps) {
  const { t } = useLanguage();
  const selectOptions = [
    { value: null as number | null, label: t('dropFinder.embellishmentNone') },
    ...(options ?? []).map((e) => ({ value: e.id as number | null, label: e.name })),
  ];
  return <Select value={value} onChange={onChange} options={selectOptions} portal />;
}
