import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Church Theme Colors
        'church-navy': {
          50: '#f0f4ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a', // Primary Navy Blue
          950: '#172554',
        },
        'church-gold': {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24', // Primary Golden Yellow
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        // Vintage Audio Equipment Colors
        'vintage-silver': {
          100: '#f8fafc',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        'vintage-bronze': {
          100: '#fef7ed',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'vintage-brushed': 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 25%, #e2e8f0 50%, #cbd5e1 75%, #e2e8f0 100%)',
        'vintage-metal': 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)',
        'church-gradient': 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #1e3a8a 100%)',
      },
      boxShadow: {
        'vintage-inset': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3), inset 0 -2px 4px 0 rgba(255, 255, 255, 0.3)',
        'vintage-outset': '0 4px 8px 0 rgba(0, 0, 0, 0.3), 0 -2px 4px 0 rgba(255, 255, 255, 0.3)',
        'vintage-button': '0 4px 8px rgba(30, 58, 138, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.2)',
        'vintage-panel': '0 8px 16px rgba(0, 0, 0, 0.2), inset 0 1px 4px rgba(255, 255, 255, 0.1)',
      },
      borderRadius: {
        'vintage': '0.5rem',
        'vintage-button': '50%',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.5' },
        },
        'vintage-glow': {
          '0%, 100%': {
            boxShadow: '0 0 5px rgba(251, 191, 36, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.2)'
          },
          '50%': {
            boxShadow: '0 0 20px rgba(251, 191, 36, 0.8), inset 0 1px 2px rgba(255, 255, 255, 0.2)'
          },
        },
        'tape-roll': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'vintage-glow': 'vintage-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'tape-roll': 'tape-roll 3s linear infinite',
      },
      fontSize: {
        'vintage-label': '0.625rem',
        'vintage-display': '1.125rem',
      },
      fontFamily: {
        'vintage': ['Monaco', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
