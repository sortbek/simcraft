/** Single source of truth for Top Gear's density system: row metrics plus the
 *  card and grid geometry that go with them. `comfortable` reproduces the
 *  pre-compaction sizes exactly and stays the default for every consumer that
 *  doesn't offer the toggle (Upgrade Compare, the gem/enchant edit dialog). */

export type GearRowDensity = 'comfortable' | 'compact' | 'ultra';

export const GEAR_ROW_DENSITIES: GearRowDensity[] = ['comfortable', 'compact', 'ultra'];

/** Per-row classes, applied inside `GearItemRow`. */
export const GEAR_ROW_METRICS = {
  comfortable: {
    row: 'gap-2.5 px-2.5 py-2',
    icon: 'h-8 w-8',
    name: 'text-[15px]',
    details: 'text-[13px]',
    box: 'h-5 w-5',
    check: 'h-3 w-3',
    button: 'h-7 w-7',
    ilevel: 'text-xs',
  },
  compact: {
    row: 'gap-2 px-2 py-1',
    icon: 'h-6 w-6',
    name: 'text-[13px]',
    details: 'text-[11px]',
    box: 'h-4 w-4',
    check: 'h-2.5 w-2.5',
    button: 'h-5 w-5',
    ilevel: 'text-[11px]',
  },
  ultra: {
    row: 'gap-1.5 px-1.5 py-0.5',
    icon: 'h-5 w-5',
    name: 'text-[13px]',
    details: 'text-[11px]',
    box: 'h-4 w-4',
    check: 'h-2.5 w-2.5',
    button: 'h-5 w-5',
    ilevel: 'text-[11px]',
  },
} as const satisfies Record<GearRowDensity, Record<string, string>>;

/** Card padding, grid gap and the auto-fill track width for the card grids.
 *  `minCol`/`gemMinCol` feed `repeat(auto-fill, minmax(Npx, 1fr))` — container
 *  driven, so they hold up at any window width or content scale. */
export const GEAR_DENSITY_LAYOUT = {
  comfortable: {
    card: 'p-3.5',
    cardGap: 'space-y-1',
    title: 'mb-2 text-[13px]',
    rule: '!my-1.5',
    gap: 'gap-3',
    minCol: 300,
    gemMinCol: 220,
  },
  compact: {
    card: 'p-2.5',
    cardGap: 'space-y-0.5',
    title: 'mb-1 text-[12px]',
    rule: '!my-1',
    gap: 'gap-2',
    minCol: 300,
    gemMinCol: 190,
  },
  ultra: {
    card: 'p-2',
    cardGap: 'space-y-0.5',
    title: 'mb-1 text-[12px]',
    rule: '!my-1',
    gap: 'gap-2',
    minCol: 260,
    gemMinCol: 190,
  },
} as const satisfies Record<
  GearRowDensity,
  {
    card: string;
    cardGap: string;
    title: string;
    rule: string;
    gap: string;
    minCol: number;
    gemMinCol: number;
  }
>;

/** `grid-template-columns` for a density's card grid. The `min(Npx, 100%)` keeps
 *  a track from outgrowing its container: a bare `minmax(Npx, 1fr)` cannot
 *  shrink below N, so a narrow container (small window at 150% content scale)
 *  would overflow horizontally. */
export function gearGridColumns(density: GearRowDensity, gem = false): string {
  const { minCol, gemMinCol } = GEAR_DENSITY_LAYOUT[density];
  return `repeat(auto-fill, minmax(min(${gem ? gemMinCol : minCol}px, 100%), 1fr))`;
}

/** Class string for a card at this density. */
export function gearCardClass(density: GearRowDensity): string {
  const { cardGap, card } = GEAR_DENSITY_LAYOUT[density];
  return `card ${cardGap} ${card}`;
}

/** `className` + `style` for a card grid, so no call site reassembles them. */
export function gearGridProps(
  density: GearRowDensity,
  gem = false
): { className: string; style: { gridTemplateColumns: string } } {
  return {
    className: `grid ${GEAR_DENSITY_LAYOUT[density].gap}`,
    style: { gridTemplateColumns: gearGridColumns(density, gem) },
  };
}
