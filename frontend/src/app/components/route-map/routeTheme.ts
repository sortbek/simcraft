import { line } from '../../lib/themeColors';

/* Design tokens for the M+ Route screens, read from the active color theme
 * (globals.css `--c-*`) so the pages match SimHammer, not the cooler design mock.
 * Pull-marker colors below stay as-is — semantic, not chrome. */
export const T = {
  bg: 'rgb(var(--c-background))', // background
  panel: 'rgb(var(--c-surface-container))', // surface-container (cards/panels)
  surface: 'rgb(var(--c-surface-container-high))', // surface-container-high (inputs, steppers)
  surfaceHi: 'rgb(var(--c-surface-container-highest))', // surface-container-highest (hover)
  border: line(0.06), // card hairline
  borderHi: line(0.11), // stronger hairline, on hover
  gold: 'rgb(var(--c-primary))', // primary / gold
  goldDim: 'rgb(var(--c-primary-container))', // gold-dark
  goldSub: 'rgb(var(--c-primary) / 0.1)',
  goldBord: 'rgb(var(--c-primary) / 0.35)',
  text: 'rgb(var(--c-on-surface))', // on-surface
  text2: 'rgb(var(--c-on-surface-variant))', // on-surface-variant
  muted: 'rgb(var(--c-outline))', // outline
  dim: 'rgb(var(--c-fg-4))', // fg-4 (separators, faint labels)
  faint: 'rgb(var(--c-surface-container-highest))', // surface-container-highest (tracks, grid)
  red: 'rgb(var(--c-negative))', // negative
  boss: 'rgb(var(--c-route-boss))', // boss marker accent (semantic, darker in light themes)
  picked: '#5fbfff', // selection highlight (semantic)
} as const;

/** Route-source identity colors, keyed by RouteKind (see routes-model). One
 *  owner so the card dot and the import tag never disagree. */
export const SOURCE_COLORS: Record<string, string> = {
  pulls: '#5fbf6a', // Built
  simc: '#c95fd6', // keystone.guru
  mdt: '#6ea7cc', // MDT
  footer: '#6ea7cc', // legacy SimC
};

/** Fallback pull color used by the design when a pull declares none. */
export const DEFAULT_PULL_COLOR = '228b22';

/** Palette new (drawn) pulls cycle through, matching the prototype. */
export const NEW_PULL_COLORS = [
  'e08a3f',
  'c95fd6',
  '5fb0d6',
  'd6c45f',
  '6fd65f',
  'd65f7a',
  '7f9fe0',
];
