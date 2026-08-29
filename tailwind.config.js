/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC',
          'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', 'Arial',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          50:  '#F7F8FA',
          100: '#EFF1F5',
          200: '#E1E4EB',
          300: '#CBD0DC',
          400: '#9BA3B5',
          500: '#6B7488',
          600: '#4A5365',
          700: '#353D4D',
          800: '#232938',
          900: '#161B26',
        },
        accent: {
          50:  '#EAF1FF',
          100: '#D6E4FF',
          200: '#ADC8FF',
          300: '#84ADFF',
          400: '#5B91FF',
          500: '#3B76F5',
          600: '#2D5BD0',
          700: '#2246A3',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16, 22, 38, 0.04), 0 4px 12px rgba(16, 22, 38, 0.06)',
        'soft-lg': '0 2px 8px rgba(16, 22, 38, 0.06), 0 12px 28px rgba(16, 22, 38, 0.10)',
      },
    },
  },
  plugins: [],
}
