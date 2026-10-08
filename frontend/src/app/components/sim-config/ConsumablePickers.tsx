'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { CONSUMABLE_LABELS } from '../../lib/sim-config-defaults';
import { useLanguage } from '../../lib/i18n';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import { iconProps } from '../../lib/useItemInfo';
import { useDismiss } from '../../lib/useDismiss';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';

interface ConsumableEntry {
  value: string;
  shortName: string;
  name: string;
  itemId: number;
  icon: string;
  expansion: number;
  craftingQuality?: number;
  effects?: { stat?: string }[];
}

interface ConsumablesApiResponse {
  flasks: ConsumableEntry[];
  potions: ConsumableEntry[];
  foods: ConsumableEntry[];
  augments: ConsumableEntry[];
  weapon_runes: ConsumableEntry[];
}

/** One consumable across its crafting qualities ("_1" / "_2" suffixes). */
interface ConsumableGroup {
  base: string;
  name: string;
  icon: string;
  stat: string;
  current: boolean;
  /** quality → SimC value; quality 0 for items without crafted qualities. */
  variants: Record<number, string>;
}

// Current expansion for Midnight
const CURRENT_EXPANSION = 11;

const SLOT_SOURCES: { key: string; field: keyof ConsumablesApiResponse }[] = [
  { key: 'flask', field: 'flasks' },
  { key: 'food', field: 'foods' },
  { key: 'potion', field: 'potions' },
  { key: 'augmentation', field: 'augments' },
  { key: 'weapon_rune', field: 'weapon_runes' },
];

const baseOf = (value: string) => value.replace(/_\d+$/, '');
const statLabel = (stat: string) =>
  stat ? stat.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';

function buildGroups(entries: ConsumableEntry[]): ConsumableGroup[] {
  const groups = new Map<string, ConsumableGroup>();
  // Current expansion first, so the menu leads with what people actually use.
  const ordered = [
    ...entries.filter((e) => e.expansion === CURRENT_EXPANSION),
    ...entries.filter((e) => e.expansion !== CURRENT_EXPANSION),
  ];
  for (const e of ordered) {
    const base = baseOf(e.value);
    let g = groups.get(base);
    if (!g) {
      g = {
        base,
        name: e.name.replace(/\s*\(Quality \d\)$/, ''),
        icon: e.icon,
        stat: statLabel(e.effects?.[0]?.stat ?? ''),
        current: e.expansion === CURRENT_EXPANSION,
        variants: {},
      };
      groups.set(base, g);
    }
    g.variants[e.craftingQuality ?? 0] = e.value;
  }
  return [...groups.values()];
}

const qualitiesOf = (g: ConsumableGroup) =>
  Object.keys(g.variants)
    .map(Number)
    .filter((q) => q > 0)
    .sort((a, b) => a - b);

function ConsumableIcon({ icon, muted }: { icon?: string; muted?: boolean }) {
  if (!icon) {
    return (
      <span
        className={`block h-7 w-7 shrink-0 rounded-[6px] border border-dashed ${
          muted
            ? 'border-line/[0.06] bg-surface-container-lowest'
            : 'border-line/20 bg-surface-container-high'
        }`}
      />
    );
  }
  return (
    <img
      alt=""
      {...iconProps(icon)}
      className="h-7 w-7 shrink-0 rounded-[6px] border border-line/[0.11] object-cover"
    />
  );
}

// One fetch for the page: the block's collapsed summary and the pickers both
// need the list, and it changes only with the data build.
let consumablesPromise: Promise<ConsumablesApiResponse | null> | undefined;

function useConsumableData(): ConsumablesApiResponse | null {
  const [data, setData] = useState<ConsumablesApiResponse | null>(null);
  useEffect(() => {
    let alive = true;
    consumablesPromise ??= fetchJsonOr<ConsumablesApiResponse | null>(
      apiUrl('/api/consumables'),
      null
    ).then((d) => {
      if (!d) consumablesPromise = undefined; // let a later mount retry
      return d;
    });
    consumablesPromise.then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** One small icon per consumable slot, for the collapsed Sim settings summary:
 *  the chosen item's icon, a dashed box for Auto, a dim box for None. */
export function ConsumableIconStrip() {
  const { consumables } = useSimContext();
  const apiData = useConsumableData();
  const iconByValue = useMemo(() => {
    const map = new Map<string, string>();
    if (apiData) {
      for (const { field } of SLOT_SOURCES) {
        for (const e of apiData[field] ?? []) map.set(e.value, e.icon);
      }
    }
    return map;
  }, [apiData]);

  return (
    <span className="flex items-center gap-[3px]">
      {SLOT_SOURCES.map(({ key }) => {
        const value = consumables[key] || '';
        const icon = value && value !== 'disabled' ? iconByValue.get(value) : undefined;
        return icon ? (
          <img
            key={key}
            alt=""
            {...iconProps(icon)}
            className="h-4 w-4 rounded-[3px] border border-line/[0.11] object-cover"
          />
        ) : (
          <span
            key={key}
            className={`block h-4 w-4 rounded-[3px] border ${
              value === 'disabled'
                ? 'border-line/[0.06] bg-surface-container-lowest'
                : 'border-dashed border-line/20 bg-surface-container-high'
            }`}
          />
        );
      })}
    </span>
  );
}

function ConsumableSlot({
  slot,
  groups,
  value,
  onChange,
}: {
  slot: string;
  groups: ConsumableGroup[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const selected =
    value && value !== 'disabled' ? groups.find((g) => g.base === baseOf(value)) : undefined;
  const selectedQuality = selected
    ? Number(Object.entries(selected.variants).find(([, v]) => v === value)?.[0] ?? 0)
    : 0;
  const qualities = selected ? qualitiesOf(selected) : [];
  // Picks inherit the selected item's quality, else the best one available.
  const pickValue = (g: ConsumableGroup) => {
    const qs = qualitiesOf(g);
    if (!qs.length) return g.variants[0];
    return g.variants[qs.includes(selectedQuality) ? selectedQuality : qs[qs.length - 1]];
  };

  const label = !value
    ? t('simSettings.auto')
    : value === 'disabled'
      ? t('simSettings.none')
      : selected
        ? `${selected.name}${qualities.length > 1 ? ` · Q${selectedQuality}` : ''}`
        : value;

  const firstOlder = groups.findIndex((g) => !g.current);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`grid w-full grid-cols-[28px_minmax(0,1fr)_14px] items-center gap-2.5 rounded-[7px] border bg-surface-container-lowest py-1.5 pl-1.5 pr-2.5 text-left transition-colors ${
          open ? 'border-gold-edge' : 'border-line/[0.06] hover:border-line/[0.16]'
        }`}
      >
        <ConsumableIcon icon={selected?.icon} muted={value === 'disabled'} />
        <span className="flex min-w-0 flex-col gap-[5px]">
          <span className="lbl flex items-center gap-1.5">
            {CONSUMABLE_LABELS[slot]}
            {value && <span className="h-1.5 w-1.5 rounded-full bg-gold-fill" />}
          </span>
          <span
            className={`truncate text-[13px] leading-tight ${
              value ? 'font-semibold text-on-surface' : 'font-medium text-outline'
            }`}
          >
            {label}
          </span>
        </span>
        <svg
          className={`h-3.5 w-3.5 text-outline transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className="popover absolute left-0 right-0 z-50 mt-1 min-w-[260px] overflow-y-auto overscroll-contain p-1.5"
          style={{ maxHeight: '20rem' }}
        >
          {qualities.length > 1 && (
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="lbl">{t('simSettings.quality')}</span>
              <div className={TABS_TRACK}>
                {qualities.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onChange(selected!.variants[q])}
                    aria-pressed={q === selectedQuality}
                    className={tabClass(q === selectedQuality, 'sm')}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {[
            { v: '', name: t('simSettings.auto'), hint: t('simSettings.autoHint') },
            { v: 'disabled', name: t('simSettings.none'), hint: t('simSettings.noneHint') },
          ].map((opt) => (
            <button
              key={opt.v || 'auto'}
              type="button"
              onClick={() => {
                onChange(opt.v);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors ${
                value === opt.v ? 'bg-gold/[0.08]' : 'hover:bg-surface-container-highest'
              }`}
            >
              <ConsumableIcon muted={opt.v === 'disabled'} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-on-surface">{opt.name}</span>
                <span className="block text-[11.5px] text-outline">{opt.hint}</span>
              </span>
            </button>
          ))}
          <div className="mx-1 my-1.5 h-px bg-overlay/[0.06]" />
          {groups.map((g, i) => (
            <div key={g.base}>
              {i === firstOlder && (
                <div className="lbl px-2 pb-1.5 pt-2.5">{t('simSettings.olderExpansions')}</div>
              )}
              <button
                type="button"
                onClick={() => {
                  onChange(pickValue(g));
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors ${
                  selected?.base === g.base
                    ? 'bg-gold/[0.08]'
                    : 'hover:bg-surface-container-highest'
                }`}
              >
                <ConsumableIcon icon={g.icon} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-on-surface">
                    {g.name}
                  </span>
                  {g.stat && <span className="block text-[11.5px] text-outline">{g.stat}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Consumables column of the Sim settings block. An empty value means SimC
 *  picks the spec default ("Auto"); 'disabled' sims without it. */
export default function ConsumablePickers() {
  const { consumables, setConsumables } = useSimContext();
  const apiData = useConsumableData();

  const groups = useMemo(
    () =>
      Object.fromEntries(
        SLOT_SOURCES.map(({ key, field }) => [
          key,
          apiData ? buildGroups(apiData[field] ?? []) : [],
        ])
      ),
    [apiData]
  );

  return (
    <div className="flex flex-col gap-2">
      {SLOT_SOURCES.map(({ key }) => (
        <ConsumableSlot
          key={key}
          slot={key}
          groups={groups[key]}
          value={consumables[key] || ''}
          onChange={(v) => setConsumables({ ...consumables, [key]: v })}
        />
      ))}
    </div>
  );
}
