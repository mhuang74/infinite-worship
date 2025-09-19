import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        navy: {
          900: '#0A2240',
          800: '#102E59',
          700: '#1B3D73',
          600: '#2C4D8A',
          500: '#3B5EA1',
        },
        gold: {
          600: '#D4A50C',
          500: '#F5C518',
          400: '#FFD95A',
        },
        churchWhite: '#FFFFFF',
      },
      boxShadow: {
        'bevel': '0 8px 24px rgba(0,0,0,0.35)',
        'inner-lg': 'inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -2px 6px rgba(255,255,255,0.06)',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.5' },
        },
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
export default config
