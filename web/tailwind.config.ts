import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './modules/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: { 50: '#eef4ff', 100: '#dce8ff', 500: '#2f61e0', 600: '#244fc0', 700: '#1c3f9c', 900: '#0f2260' } },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
