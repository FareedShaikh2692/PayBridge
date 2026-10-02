import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral ink and surfaces; a single restrained accent. Deliberately not styled after any bank or card brand.
        ink: { DEFAULT: '#14171f', muted: '#566072', faint: '#8691a3' },
        surface: { DEFAULT: '#ffffff', sunken: '#f5f6f8', line: '#e3e6eb' },
        accent: { DEFAULT: '#1f5fbf', hover: '#184d9c', soft: '#e9f0fb' },
        good: { DEFAULT: '#13743f', soft: '#e4f4ea' },
        warn: { DEFAULT: '#8a5a00', soft: '#fdf1d6' },
        bad: { DEFAULT: '#b3261e', soft: '#fbe9e7' },
        info: { DEFAULT: '#1f5fbf', soft: '#e9f0fb' },
        series: '#2a78d6',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: { card: '0 1px 2px rgba(20, 23, 31, 0.05)' },
    },
  },
  plugins: [],
};
export default config;
