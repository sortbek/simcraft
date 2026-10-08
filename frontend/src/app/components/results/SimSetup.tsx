'use client';

/* eslint-disable @next/next/no-img-element */

import { useLanguage } from '../../lib/i18n';
import { CONSUMABLE_LABELS, EXTRA_RAID_BUFFS, RAID_BUFF_LIST } from '../../lib/sim-config-defaults';
import type { SetupConsumable, SimSetup } from '../../lib/simResultTypes';
import { getWowheadUrl, iconProps } from '../../lib/useItemInfo';
import { useConsumableLookup } from '../sim-config/ConsumablePickers';

const CONSUMABLE_ORDER = ['flask', 'food', 'potion', 'augmentation', 'weapon_rune'];

// Tokens missing from the app's lists, e.g. `flask_of_the_shattered_sun_2`.
function prettify(token: string): string {
  return token
    .replace(/_\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buffInfo(key: string): { label: string; icon?: string } {
  return (
    RAID_BUFF_LIST.find((b) => b.key === key) ?? EXTRA_RAID_BUFFS[key] ?? { label: prettify(key) }
  );
}

function Tip({ text }: { text: string }) {
  return (
    <span className="popover pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-xs text-on-surface opacity-0 transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100">
      {text}
    </span>
  );
}

function ConsumableIcon({
  label,
  entry,
  swapped = false,
}: {
  label: string;
  entry: SetupConsumable | null;
  /** Changed by the shown result rather than the base actor's own. */
  swapped?: boolean;
}) {
  const { t } = useLanguage();
  const name = entry ? (entry.name ?? prettify(entry.value)) : t('results.setupNone');
  const full = swapped ? t('results.setupSwappedItem', { name }) : name;
  const icon = entry ? (
    <img
      {...iconProps(entry.icon)}
      alt={full}
      className={`h-[30px] w-[30px] rounded-[6px] border ${
        swapped ? 'border-gold ring-2 ring-gold/40' : 'border-line/[0.11]'
      }`}
    />
  ) : (
    <span className="block h-[30px] w-[30px] rounded-[6px] border border-dashed border-line/[0.11]" />
  );
  // Linked icons get Wowhead's item tooltip; the rest get ours.
  return entry?.item_id ? (
    <a href={getWowheadUrl(entry.item_id)} target="_blank" rel="noopener noreferrer">
      {icon}
    </a>
  ) : (
    <span
      tabIndex={0}
      className="group/tip relative inline-flex rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-gold/55"
    >
      {icon}
      <Tip text={`${label}: ${full}`} />
    </span>
  );
}

function BuffIcon({ buffKey, on }: { buffKey: string; on: boolean }) {
  const { t } = useLanguage();
  const { label, icon } = buffInfo(buffKey);
  const text = on ? label : t('results.setupBuffOff', { buff: label });
  return (
    <span
      tabIndex={0}
      className="group/tip relative inline-flex rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-gold/55"
    >
      <img
        {...iconProps(icon)}
        alt={text}
        className={`h-[22px] w-[22px] rounded-[5px] border border-line/[0.11] ${on ? '' : 'brightness-[.45] grayscale'}`}
      />
      {!on && (
        <span className="pointer-events-none absolute -inset-x-0.5 top-1/2 h-0.5 -rotate-45 rounded-full bg-negative" />
      )}
      <Tip text={text} />
    </span>
  );
}

/** Consumables and raid buffs the sim actually ran with, for the hero's corner.
 *  `swapped` (slot -> SimC value) shows a Top Gear result's consumable swaps in
 *  place of the base actor's, marked so they read as that result's changes. */
export default function SimSetup({
  setup,
  swapped,
}: {
  setup: SimSetup;
  swapped?: Record<string, string>;
}) {
  const { t } = useLanguage();
  const lookup = useConsumableLookup();
  const consumableFor = (key: string): SetupConsumable | null => {
    const value = swapped?.[key];
    if (!value) return setup.consumables[key] ?? null;
    const known = lookup.get(value);
    return known
      ? {
          value,
          name: known.name,
          icon: known.icon,
          item_id: known.itemId,
          quality: known.craftingQuality,
        }
      : { value };
  };
  const anySwapped = !!swapped && Object.keys(swapped).length > 0;
  const known: string[] = RAID_BUFF_LIST.map((b) => b.key).filter((k) => k in setup.raid_buffs);
  const extra = Object.keys(setup.raid_buffs).filter((k) => !known.includes(k));
  const buffs = [...known, ...extra];

  return (
    <div className="grid gap-3.5 lg:justify-items-end lg:text-right">
      <div>
        <span className="lbl block">
          {t('config.consumables')}
          {anySwapped && (
            <span className="ml-2 normal-case tracking-normal text-gold">
              {t('results.setupSwapped')}
            </span>
          )}
        </span>
        <div className="mt-2 flex flex-wrap items-center gap-[7px] lg:justify-end">
          {CONSUMABLE_ORDER.map((key) => (
            <ConsumableIcon
              key={key}
              label={CONSUMABLE_LABELS[key]}
              entry={consumableFor(key)}
              swapped={!!swapped?.[key]}
            />
          ))}
        </div>
      </div>
      {buffs.length > 0 && (
        <div>
          <span className="lbl block">{t('config.raidBuffs')}</span>
          <div className="mt-2 flex flex-wrap items-center gap-[5px] lg:justify-end">
            {buffs.map((key) => (
              <BuffIcon key={key} buffKey={key} on={setup.raid_buffs[key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
