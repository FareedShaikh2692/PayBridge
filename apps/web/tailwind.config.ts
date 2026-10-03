import type { Config } from 'tailwindcss';

/** Every colour resolves to a design token defined in src/app/globals.css. No raw hex values in components. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: { DEFAULT: '1.25rem', md: '2rem' }, screens: { xl: '1240px' } },
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: token('card'),
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        border: token('border'),
        primary: { DEFAULT: token('primary'), hover: token('primary-hover'), soft: token('primary-soft'), foreground: token('primary-foreground') },
        success: { DEFAULT: token('success'), bright: token('success-bright'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), bright: token('warning-bright'), soft: token('warning-soft') },
        error: { DEFAULT: token('error'), bright: token('error-bright'), soft: token('error-soft') },
        // Semantic aliases used across the application screens.
        ink: { DEFAULT: token('foreground'), muted: token('muted-foreground'), faint: token('faint') },
        surface: { DEFAULT: token('card'), sunken: token('muted'), line: token('border') },
        accent: { DEFAULT: token('primary'), hover: token('primary-hover'), soft: token('primary-soft') },
        good: { DEFAULT: token('success'), bright: token('success-bright'), soft: token('success-soft') },
        warn: { DEFAULT: token('warning'), bright: token('warning-bright'), soft: token('warning-soft') },
        bad: { DEFAULT: token('error'), bright: token('error-bright'), soft: token('error-soft') },
        info: { DEFAULT: token('info'), soft: token('primary-soft') },
        series: token('chart-1'),
        signal: token('signal'),
        navy: { 900: token('navy-900'), 800: token('navy-800'), 700: token('navy-700') },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', control: 'var(--radius-control)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      boxShadow: { card: 'var(--shadow-sm)', raised: 'var(--shadow-md)', overlay: 'var(--shadow-lg)' },
      transitionDuration: { DEFAULT: '200ms' },
      keyframes: {
        'flow-down': { '0%': { transform: 'translateY(-100%)', opacity: '0' }, '15%': { opacity: '1' }, '85%': { opacity: '1' }, '100%': { transform: 'translateY(100%)', opacity: '0' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
        'travel-x': { '0%': { left: '0%', opacity: '0' }, '10%': { opacity: '1' }, '90%': { opacity: '1' }, '100%': { left: '100%', opacity: '0' } },
        'draw-check': { '0%': { strokeDashoffset: '24' }, '100%': { strokeDashoffset: '0' } },
        'pop-in': { '0%': { opacity: '0', transform: 'scale(0.92)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'progress-indeterminate': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(250%)' } },
      },
      animation: { 'flow-down': 'flow-down 2.4s ease-in-out infinite', 'fade-up': 'fade-up 300ms ease-out both', shimmer: 'shimmer 1.6s linear infinite', 'travel-x': 'travel-x 3.2s ease-in-out infinite', 'draw-check': 'draw-check 500ms ease-out 150ms both', 'pop-in': 'pop-in 250ms ease-out both', 'progress-indeterminate': 'progress-indeterminate 1.2s ease-in-out infinite' },
    },
  },
  plugins: [],
};
export default config;
