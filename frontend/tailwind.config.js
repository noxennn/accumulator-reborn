/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'aqi-good': '#00C853',
        'aqi-moderate': '#FFD600',
        'aqi-poor': '#FF9800',
        'aqi-very-poor': '#F44336',
        'aqi-hazardous': '#9C27B0',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: ['light', 'dark'],
  },
}