/** Slot groups with nothing to choose, condensed into one row of equipped icons.
 *  Clicking one opens its card again — the per-item menu there is the only way to
 *  create alternatives (upgraded copy, catalyst, socket, gem edit). */
/* eslint-disable @next/next/no-img-element */

import { getWowheadData, getWowheadUrl, iconProps, localizedItemName } from '../../lib/useItemInfo';
import { qualityHex } from '../../lib/qualityColors';
import { unchangedSlotCount, type VisibleGroup } from './topGearSelection';

interface TopGearUnchangedStripProps {
  groups: VisibleGroup[];
  locale: string;
  onPromote: (label: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export default function TopGearUnchangedStrip({
  groups,
  locale,
  onPromote,
  t,
}: TopGearUnchangedStripProps) {
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[10px] border border-line/[0.06] bg-shade/[0.15] px-6 py-3.5">
      <p className="lbl">{t('topGear.unchangedSlots')}</p>

      <div className="flex flex-wrap gap-[5px]">
        {groups.map(({ group, equipped }) =>
          equipped.map((item) => {
            const label = `${t(group.label)}: ${localizedItemName(item.item_id, item.name, locale)}`;
            const icon = (
              <img
                {...iconProps(item.icon)}
                alt=""
                width={22}
                height={22}
                className="h-full w-full"
                loading="lazy"
              />
            );
            const frame = { borderColor: qualityHex(item.quality) };
            const shared =
              'block h-[22px] w-[22px] shrink-0 cursor-pointer overflow-hidden rounded-[4px] border transition-all hover:ring-2 hover:ring-gold/60';

            // With a Wowhead id this is an anchor, so the tooltip attaches as it
            // does everywhere else and the href keeps it keyboard focusable; the
            // click promotes instead of navigating. Without an id there is no
            // href, and an anchor without one is not focusable — which would
            // strand the slot's per-item menu out of keyboard reach — so it
            // renders as a button.
            return item.item_id > 0 ? (
              <a
                key={`${group.label}-${item.uid}`}
                href={getWowheadUrl(item.item_id, locale)}
                data-wowhead={getWowheadData(item)}
                aria-label={label}
                onClick={(event) => {
                  event.preventDefault();
                  onPromote(group.label);
                }}
                className={shared}
                style={frame}
              >
                {icon}
              </a>
            ) : (
              <button
                key={`${group.label}-${item.uid}`}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => onPromote(group.label)}
                className={shared}
                style={frame}
              >
                {icon}
              </button>
            );
          })
        )}
      </div>

      <p className="text-[12.5px] text-outline">
        {t('topGear.unchangedSlotsHint', { count: unchangedSlotCount(groups) })}
      </p>
    </div>
  );
}
