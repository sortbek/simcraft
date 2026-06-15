/* Design tokens for the M+ Route screens, mapped to the app's own palette
 * (tailwind.config.ts) so the pages match SimHammer, not the cooler design mock.
 * Pull-marker colors below stay as-is — semantic, not chrome. */
export const T = {
  bg: '#131313', // background
  panel: '#201f1f', // surface-container (cards/panels)
  surface: '#2a2a2a', // surface-container-high (inputs, steppers)
  surfaceHi: '#353534', // surface-container-highest (hover)
  border: 'rgba(79,70,53,0.5)', // outline-variant, ghost border
  borderHi: 'rgba(155,143,124,0.35)', // outline, on hover
  gold: '#f2bf4e', // primary / gold
  goldDim: '#c8992a', // gold-dark
  goldSub: 'rgba(242,191,78,0.12)',
  goldBord: 'rgba(242,191,78,0.35)',
  text: '#e5e2e1', // on-surface
  text2: '#d2c5b0', // on-surface-variant
  muted: '#9b8f7c', // muted / outline
  dim: '#4f4635', // outline-variant (separators, faint labels)
  faint: '#353534', // surface-container-highest (tracks, grid)
  red: '#f87171', // destructive accent (matches app red-400)
  boss: '#ffcf5a', // boss marker accent (semantic)
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
