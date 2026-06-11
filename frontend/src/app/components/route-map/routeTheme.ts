/* Design tokens for the M+ Route Viewer (Forces Timeline direction).
 * Ported verbatim from the Claude Design handoff so the viewer matches the
 * approved mock pixel-for-pixel — dark surfaces + warm gold accent. */
export const T = {
  bg: '#181818',
  panel: '#1d1d1d',
  surface: '#232323',
  surfaceHi: '#2b2b2b',
  border: '#2a2a2a',
  borderHi: '#383838',
  gold: '#f5a623',
  goldDim: '#c98718',
  goldSub: 'rgba(245,166,35,0.12)',
  goldBord: 'rgba(245,166,35,0.35)',
  text: '#e4e4e4',
  text2: '#a8a8a8',
  muted: '#6e6e6e',
  dim: '#454545',
  faint: '#2f2f2f',
  red: '#e0524a',
  boss: '#ffcf5a',
  picked: '#5fbfff',
} as const;

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
