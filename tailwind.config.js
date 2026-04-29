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
          200: '#C0CCE0',
          300: '#8C9CC8',
          400: '#5E74B5',
          500: '#3D55A0',
          600: '#2F4585', // メインCTA
          700: '#243667',
          800: '#19274D',
          900: '#131D3C',
          950: '#0A1020',
        },
        neutral: {
          0:   '#FFFFFF',
          50:  '#F7F6F3', // 画面背景
          100: '#ECEAE3', // 区切り罫線
          200: '#DDD9CE',
          300: '#B8B2A1',
          400: '#7A7567', // アイコン (UI 3:1) — text 用途は dark で禁止
          500: '#5E5A4F', // 補助テキスト (light AA pass)
          600: '#46433B',
          700: '#33312A', // 本文
          800: '#23211D',
          900: '#1A1815', // 見出し
          950: '#0F0E0C',
        },
        success: {
          50:  '#E6F2EC',
          100: '#CCE6D9',
          200: '#9FCCB2',
          300: '#6FB08A',
          400: '#4A9F71',
          500: '#2F8F5E',
          600: '#257A50',
          700: '#1C6442',
          800: '#144F34',
          900: '#0D3B27',
          950: '#072518',
        },
        warning: {
          50:  '#FBF1DD',
          100: '#F5E1B0',
          200: '#EDCB7E',
          300: '#E0AC4B',
          400: '#D49428',
          500: '#C9821E',
          600: '#A86C14',
          700: '#88560C',
          800: '#694107',
          900: '#4C2E03',
          950: '#321D01',
        },
        danger: {
          50:  '#F7E5E2',
          100: '#EFC8C3',
          200: '#E19A92',
          300: '#D26C61',
          400: '#C75045',
          500: '#C0392B',
          600: '#A02E22',
          700: '#7F241A',
          800: '#601B13',
          900: '#44130D',
          950: '#2C0B07',
        },
        info: {
          50:  '#E2EEF5',
          100: '#C0D8EA',
          200: '#8AB8D8',
          300: '#5598C6',
          400: '#3B82B0',
          500: '#2F6F94',
          600: '#255B7A',
          700: '#1C4963',
          800: '#13384C',
          900: '#0B2736',
          950: '#061820',
        },
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
