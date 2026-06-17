/** Blizzard armory regions, shared by raid-roster creation and the general
 *  character import. Order doubles as the dropdown order. */
export const REGIONS = ['eu', 'us', 'kr', 'tw'] as const;
export type Region = (typeof REGIONS)[number];
