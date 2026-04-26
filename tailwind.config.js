/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#EEF1F8',
          100: '#D8DFEE',
          300: '#8C9CC8',
          500: '#3D55A0',
          600: '#2F4585', // メインCTA
          700: '#243667',
          900: '#131D3C',
        },
        neutral: {
          0:   '#FFFFFF',
          50:  '#F7F6F3', // 画面背景
          100: '#EFEDE8', // 区切り罫線
          200: '#E2DFD8',
          300: '#C8C4BA',
          500: '#8A8579',
          700: '#4A463E', // 本文
          900: '#1F1D18', // 見出し
        },
        success: { 50: '#E6F2EC', 500: '#2F8F5E' },
        warning: { 50: '#FBF1DD', 500: '#C9821E' },
        danger:  { 50: '#F7E5E2', 500: '#C0392B' },
        info:    { 50: '#E2EEF5', 500: '#2F6F94' },
        accent: {
          amber: '#D4A04C',
          teal:  '#3F8A8A',
          rose:  '#B86472',
          // ↓ 旧 accent-600 等の互換用（Phase 5 で削除予定）
          50:  '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
      },
      fontFamily: {
        sans:  ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
        serif: ['"Noto Serif JP"', 'serif'],          // ヒーロー1箇所のみ
        num:   ['"Inter Tight"', '"Noto Sans JP"', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display':   ['28px', { lineHeight: '1.25', fontWeight: '700' }],
        'heading-1': ['22px', { lineHeight: '1.35', fontWeight: '700' }],
        'heading-2': ['18px', { lineHeight: '1.4',  fontWeight: '600' }],
        'heading-3': ['16px', { lineHeight: '1.45', fontWeight: '600' }],
        'body':      ['15px', { lineHeight: '1.65', fontWeight: '400' }],
        'body-sm':   ['13px', { lineHeight: '1.55', fontWeight: '400' }],
        'label':     ['12px', { lineHeight: '1.4',  fontWeight: '600', letterSpacing: '0.04em' }],
        'kpi-lg':    ['32px', { lineHeight: '1.1',  fontWeight: '600' }],
        'kpi-md':    ['22px', { lineHeight: '1.15', fontWeight: '600' }],
      },
      spacing: {
        '18': '72px',
        '22': '88px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(31, 29, 24, 0.04)',
        sm: '0 1px 3px rgba(31, 29, 24, 0.06), 0 1px 2px rgba(31, 29, 24, 0.04)',
        md: '0 4px 12px rgba(31, 29, 24, 0.08)',
        lg: '0 10px 24px rgba(31, 29, 24, 0.10)',
      },
      transitionDuration: {
        '120': '120ms',
        '180': '180ms',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'slide-up': 'slide-up 180ms cubic-bezier(0.2, 0, 0, 1)',
        'fade-in':  'fade-in 120ms cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
};
