import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Core accent
        primary: { DEFAULT: '#f2bf4e', container: '#c8992a' },
        background: '#131313',
        'on-surface': '#e5e2e1',
        'on-surface-variant': '#d2c5b0',

        // Surface hierarchy (tonal elevation system)
        surface: {
          DEFAULT: '#131313',
          dim: '#131313',
          container: '#201f1f',
          'container-low': '#1c1b1b',
          'container-high': '#2a2a2a',
          'container-highest': '#353534',
          bright: '#3a3939',
        },

        // Outlines (ghost borders)
        outline: { DEFAULT: '#9b8f7c', variant: '#4f4635' },

        // Secondary / Tertiary
        secondary: { DEFAULT: '#dfc38e', container: '#5a461d' },
        tertiary: { DEFAULT: '#a9c7ff', container: '#75a1eb' },

        // On-primary (dark text on gold surfaces)
        'on-primary': { DEFAULT: '#402d00', container: '#483400' },

        // Error
        error: { DEFAULT: '#ffb4ab', container: '#93000a' },

        // Game-specific aliases (kept for compatibility)
        gold: {
          DEFAULT: '#f2bf4e',
          light: '#E4BE6A',
          dark: '#c8992a',
          muted: '#c8992a',
        },
        bg: '#131313',
        muted: '#9b8f7c',

        // Legacy border tokens (used by many components — maps to outline-variant)
        border: {
          DEFAULT: '#4f4635',
          light: '#9b8f7c',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        headline: [
          'Manrope',
          'Inter',
          '-apple-system',
          'sans-serif',
        ],
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
        glow: '0 0 20px rgba(242, 191, 78, 0.08)',
        'glow-lg': '0 0 40px rgba(242, 191, 78, 0.12)',
        card: 'none',
        'card-hover': '0 4px 12px rgba(0, 0, 0, 0.4)',
        ambient: '0 20px 40px rgba(0, 0, 0, 0.4)',
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
