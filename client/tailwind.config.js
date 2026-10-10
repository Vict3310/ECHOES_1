/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FBFAF7',
        ink: '#12281A',
        brand: {
          DEFAULT: '#42A85D',
          deep: '#1E4D33',
          hover: '#2A6647',
          soft: '#E4EFDA',
        },
      },
      fontFamily: {
        display: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tighter: '-0.03em',
      },
      keyframes: {
        drift1: {
          '0%,100%': { transform: 'translate(0,0) rotate(0deg)' },
          '50%': { transform: 'translate(30px,-40px) rotate(8deg)' },
        },
        drift2: {
          '0%,100%': { transform: 'translate(0,0) rotate(0deg)' },
          '50%': { transform: 'translate(-40px,30px) rotate(-6deg)' },
        },
        drift3: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(20px,50px) scale(1.05)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'drift-a': 'drift1 14s ease-in-out infinite',
        'drift-b': 'drift2 19s ease-in-out infinite',
        'drift-c': 'drift3 24s ease-in-out infinite',
        'fade-up': 'fade-up .4s ease-out both',
      },
    },
  },
  plugins: [],
};
