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
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        error: { DEFAULT: token('error'), soft: token('error-soft') },
        // Semantic aliases used across the application screens.
        ink: { DEFAULT: token('foreground'), muted: token('muted-foreground'), faint: token('faint') },
        surface: { DEFAULT: token('card'), sunken: token('muted'), line: token('border') },
        accent: { DEFAULT: token('primary'), hover: token('primary-hover'), soft: token('primary-soft') },
        good: { DEFAULT: token('success'), soft: token('success-soft') },
        warn: { DEFAULT: token('warning'), soft: token('warning-soft') },
        bad: { DEFAULT: token('error'), soft: token('error-soft') },
        info: { DEFAULT: token('info'), soft: token('primary-soft') },
        series: token('chart-1'),
        signal: token('signal'),
        navy: { 900: token('navy-900'), 800: token('navy-800'), 700: token('navy-700') },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      boxShadow: { card: 'var(--shadow-sm)', raised: 'var(--shadow-md)', overlay: 'var(--shadow-lg)' },
      transitionDuration: { DEFAULT: '200ms' },
      keyframes: {
        'flow-down': { '0%': { transform: 'translateY(-100%)', opacity: '0' }, '15%': { opacity: '1' }, '85%': { opacity: '1' }, '100%': { transform: 'translateY(100%)', opacity: '0' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: { 'flow-down': 'flow-down 2.4s ease-in-out infinite', 'fade-up': 'fade-up 300ms ease-out both', shimmer: 'shimmer 1.6s linear infinite' },
    },
  },
  plugins: [],
};
export default config;
