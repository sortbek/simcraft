'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import GearItemRow from '../gear/GearItemRow';
import { qualityHex } from '../../lib/qualityColors';
import { SLOT_LABELS } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { useSimContext } from '../sim-config/SimContext';
import ForeverCharacterCard from './ForeverCharacterCard';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsCard from './ForeverSettingsCard';
import { blockedReason } from './specs';
import { groupForTopGear } from './topGearGroups';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSubmit } from './useForeverSubmit';

const GROUP_LABEL: Record<string, string> = { finger: 'Rings', trinket: 'Trinkets' };

export default function ForeverTopGear() {
  const { simcInput } = useSimContext();
  const { t } = useLanguage();
  const { summary, error } = useForeverImport(simcInput);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSpecKey(summary?.spec_key ?? null), [summary?.spec_key]);
  useEffect(() => setSelected(new Set()), [simcInput]);

  const groups = useMemo(
    () => groupForTopGear(summary?.equipped ?? [], summary?.bags ?? []),
    [summary]
  );

  const blocked = summary ? blockedReason(summary.level, specKey) : null;
  const buildPayload = useCallback(
    () =>
      summary && !blocked && selected.size > 0
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            bag_items: [...selected].map((i) => ({
              item_id: summary.bags[i].item_id,
              enchant_id: summary.bags[i].enchant_id,
            })),
          }
        : null,
    [summary, blocked, selected, simcInput, specKey, settings.iterations, settings.fightLength]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/top-gear', buildPayload);
  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const status = blocked
    ? t(`forever.blocked.${blocked}`)
    : selected.size === 0
      ? t('forever.selectItems')
      : t('forever.selectedCount', { count: selected.size });

  return (
    <>
      {error && <ErrorAlert message={error} />}
      {summary && (
        <>
          <ForeverSettingsCard {...settings} />
          <ForeverCharacterCard summary={summary} specKey={specKey} onSpecChange={setSpecKey} />
          {groups.length === 0 ? (
            <p className="card px-6 py-5 text-sm text-outline">{t('forever.noBagItems')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {groups.map(([slot, g]) => (
                <div key={slot} className="card space-y-1 px-3 py-3">
                  <p className="lbl px-1">{GROUP_LABEL[slot] ?? SLOT_LABELS[slot] ?? slot}</p>
                  {g.equipped.map((e) => (
                    <GearItemRow
                      key={`eq-${e.slot}`}
                      icon={e.icon || 'inv_misc_questionmark'}
                      name={e.name}
                      nameColor={qualityHex(e.quality)}
                      ilevel={e.ilevel}
                      equipped
                    />
                  ))}
                  {g.bags.map(({ gear, index }) => (
                    <GearItemRow
                      key={`bag-${index}`}
                      icon={gear.icon || 'inv_misc_questionmark'}
                      name={gear.name}
                      nameColor={qualityHex(gear.quality)}
                      ilevel={gear.ilevel}
                      selectable
                      checked={selected.has(index)}
                      onToggle={() => toggle(index)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <ErrorAlert message={submitError} />
      <ForeverFooter
        onSubmit={submit}
        submitting={submitting}
        disabled={!summary || !!blocked || selected.size === 0}
        label={t('button.runSimulation')}
        status={summary ? status : null}
      />
    </>
  );
}
