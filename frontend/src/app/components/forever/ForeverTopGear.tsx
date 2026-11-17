'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import GearItemRow from '../gear/GearItemRow';
import { qualityHex } from '../../lib/qualityColors';
import { getForeverWowheadUrl } from '../../lib/useItemInfo';
import { SLOT_LABELS } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { useSimContext } from '../sim-config/SimContext';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsBlock from './ForeverSettingsBlock';
import { useForeverBuffs } from './useForeverBuffs';
import { useForeverTalents } from './useForeverTalents';
import ForeverTalentCard from './ForeverTalentCard';
import ForeverWarnings from './ForeverWarnings';
import { blockedReason } from './specs';
import { groupForTopGear } from './topGearGroups';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSpec } from './useForeverSpec';
import { useForeverSubmit } from './useForeverSubmit';

const GROUP_LABEL: Record<string, string> = { finger: 'Rings', trinket: 'Trinkets' };

export default function ForeverTopGear() {
  const { simcInput } = useSimContext();
  const { t, locale } = useLanguage();
  const talents = useForeverTalents(simcInput);
  const { summary, error } = useForeverImport(simcInput, talents.edited);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useForeverSpec(simcInput, summary?.spec_key ?? null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set()), [simcInput]);

  const groups = useMemo(
    () => groupForTopGear(summary?.equipped ?? [], summary?.bags ?? []),
    [summary]
  );

  const blocked = summary ? blockedReason(summary.level, summary.has_sheet, specKey) : null;
  const buffs = useForeverBuffs((specKey && summary?.sim_options?.[specKey]) || null);
  const buildPayload = useCallback(
    () =>
      summary && !blocked && selected.size > 0
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            talents_string: talents.edited ?? undefined,
            bag_items: [...selected].map((i) => ({
              item_id: summary.bags[i].item_id,
              enchant_id: summary.bags[i].enchant_id,
              random_suffix: summary.bags[i].random_suffix,
            })),
          }
        : null,
    [
      summary,
      blocked,
      selected,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.edited,
    ]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/top-gear', buildPayload);
  const buildComparePayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            builds: [
              {
                name: t('forever.exportedTalents'),
                talents_string: summary.exported_talents_string,
              },
              ...talents.builds,
            ],
          }
        : null,
    [
      summary,
      blocked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.builds,
      t,
    ]
  );
  const compare = useForeverSubmit('/api/forever/talent-compare', buildComparePayload);
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
          <ForeverSettingsBlock
            {...settings}
            buffs={buffs}
            levelling={(summary?.level ?? 60) < 60}
          />
          <ForeverTalentCard
            summary={summary}
            specKey={specKey}
            onSpecChange={setSpecKey}
            talents={talents}
            compare={compare}
          />
          <ForeverWarnings warnings={summary.warnings} />
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
                      href={getForeverWowheadUrl('item', e.item_id, locale)}
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
                      href={getForeverWowheadUrl('item', gear.item_id, locale)}
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
