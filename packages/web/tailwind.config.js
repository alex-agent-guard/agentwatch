/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#06070a',
          secondary: '#0d0e12',
          elevated: '#151820',
        },
        accent: {
          blue: '#4d9fff',
          cyan: '#2eecc9',
          amber: '#ffb547',
          red: '#ff5c5e',
          purple: '#9b7bff',
        },
        text: {
          primary: '#FFFFFF',
          secondary: '#9CA3AF',
          muted: '#5C6270',
          data: '#E8ECF1',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
        'brand-cn': ['Noto Serif SC', 'Songti SC', 'STSong', 'serif'],
        'brand-en': ['Cormorant Garamond', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(41, 121, 255, 0.15)',
        'glow-sm': '0 0 20px rgba(41, 121, 255, 0.12)',
      },
    },
  },
  plugins: [],
};
