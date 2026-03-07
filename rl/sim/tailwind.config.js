/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
        },
        energy: {
          solar: '#f59e0b',
          battery: '#0d9488',
          grid: '#6366f1',
          consumption: '#ef4444',
          generation: '#10b981',
          cooling: '#3b82f6',
          dhw: '#ec4899',
          carbon: '#8b5cf6',
        },
      },
    },
  },
  plugins: [],
};
