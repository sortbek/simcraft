import type { Config } from 'tailwindcss';

// Theme colors live in globals.css as `--c-*` RGB channels so alpha modifiers keep working.
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
// Alpha scaled by --c-{name}-k, so a light theme can strengthen hairlines without per-class changes.
const k = (name: string) => `rgb(var(--c-${name}) / calc(<alpha-value> * var(--c-${name}-k)))`;

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Core accent
        primary: { DEFAULT: c('primary'), container: c('primary-container') },
        background: c('background'),
        'on-surface': c('on-surface'),
        'on-surface-variant': c('on-surface-variant'),

        // Surface hierarchy (tonal elevation system)
        surface: {
          DEFAULT: c('background'),
          dim: c('background'),
          container: c('surface-container'),
          'container-lowest': c('surface-container-lowest'),
          'container-low': c('surface-container-low'),
          'container-high': c('surface-container-high'),
          'container-highest': c('surface-container-highest'),
        },

        // Outlines (ghost borders)
        outline: { DEFAULT: c('outline'), variant: c('outline-variant') },
        // Faintest text (mock --fg-4)
        'fg-4': c('fg-4'),

        // Semantic tints from the UI-polish mock
        positive: c('positive'),
        negative: c('negative'),
        info: c('info'),
        warning: c('warning'),
        ench: c('ench'),
        gem: c('gem'),
        quality: {
          poor: c('q-poor'),
          common: c('q-common'),
          uncommon: c('q-uncommon'),
          rare: c('q-rare'),
          epic: c('q-epic'),
          legendary: c('q-legendary'),
          artifact: c('q-artifact'),
          heirloom: c('q-heirloom'),
        },
        // Hairlines (border/divide/ring), hover overlays and dark shades/backdrops
        line: k('line'),
        overlay: k('overlay'),
        shade: k('shade'),
        popover: c('popover'),
        // Windows title-bar close button hover
        'win-close': '#c42b1c',

        // Secondary / Tertiary
        secondary: { DEFAULT: c('secondary'), container: c('secondary-container') },
        tertiary: { DEFAULT: c('tertiary'), container: c('tertiary-container') },

        // On-primary (dark text on gold surfaces)
        'on-primary': { DEFAULT: c('on-primary'), container: c('on-primary-container') },
        // Ink on saturated non-gold badges (quality, negative)
        'on-badge': c('on-badge'),

        // Game-specific aliases (kept for compatibility)
        gold: {
          DEFAULT: c('primary'),
          light: c('gold-light'),
          dark: c('primary-container'),
          // Solid gold surfaces (filled buttons, checkboxes, dots, progress); DEFAULT is text/borders
          fill: c('primary-fill'),
          'fill-hover': c('primary-fill-hover'),
          // Opaque-capable selected-state colors (globals.css --gold-*)
          tint: 'var(--gold-tint)',
          sel: 'var(--gold-sel)',
          edge: 'var(--gold-edge)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        headline: ['Manrope', 'Inter', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        md: '0.25rem',
        lg: '0.25rem',
        xl: '0.5rem',
        '2xl': '0.75rem',
      },
      boxShadow: {
        glow: '0 0 20px rgb(var(--c-primary) / 0.08)',
        ambient: '0 20px 40px rgb(var(--c-shade) / calc(0.4 * var(--c-shade-k)))',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
