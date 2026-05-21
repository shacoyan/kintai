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
          400: '#6B6657', // text/icon 兼用 (white に対し ~5.0:1) — Loop 41
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
          500: '#88560C', // Loop 41: AA 4.5:1 達成 (旧 #C9821E)
          600: '#6B4309', // Loop 41 (旧 #A86C14)
          700: '#5A3807', // Loop 41 (旧 #88560C)
          800: '#3F2604', // Loop 41 (旧 #694107)
          900: '#2A1902', // Loop 41 (旧 #4C2E03)
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
          500: '#1C4963', // Loop 41: AA 7.0:1 達成 (旧 #2F6F94)
          600: '#163A4F', // Loop 41 (旧 #255B7A)
          700: '#0F2D40', // Loop 41 (旧 #1C4963)
          800: '#091E2B', // Loop 41 (旧 #13384C)
          900: '#04131C', // Loop 41 (旧 #0B2736)
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
        weekend: {
          saturday: {
            50:  '#EAF1F7',
            100: '#D5E3EE',
            700: '#1F4F70',
            900: '#0A1A28',
          },
          sunday: {
            50:  '#F7E9E7',
            100: '#EFCFCB',
            700: '#7A2419',
            900: '#2A0E0A',
          },
          holiday: {
            50:  '#F2E9DD',
            100: '#E5D3B7',
            700: '#5A3807',
            900: '#2A1902',
          },
        },
        member: {
          1:  { 100: '#E6E1D4', 300: '#C9B97E', 700: '#806717', 800: '#665010' },
          2:  { 100: '#D9E8F0', 300: '#7FB0CC', 700: '#285C80', 800: '#1F4965' },
          3:  { 100: '#D7EAE0', 300: '#7AB69A', 700: '#28704D', 800: '#1F5A3E' },
          4:  { 100: '#F4E8D4', 300: '#DDB97A', 700: '#94600D', 800: '#7A4F0A' },
          5:  { 100: '#D7E5F0', 300: '#6F8FB8', 700: '#284980', 800: '#1F3A66' },
          6:  { 100: '#EDD9D9', 300: '#C77A7A', 700: '#942828', 800: '#7A1F1F' },
          7:  { 100: '#E8D9E5', 300: '#B07AAA', 700: '#702866', 800: '#5A1F52' },
          8:  { 100: '#D7E8E5', 300: '#7AB0A8', 700: '#286B65', 800: '#1F5550' },
          9:  { 100: '#E5DCD0', 300: '#A89878', 700: '#705C3D', 800: '#5A4830' },
          10: { 100: '#DCE0E5', 300: '#8C95A3', 700: '#3A4250', 800: '#2D3540' },
        },
        'leave-type': {
          paid:          { 100: '#D7EAE0', 500: '#2F8F5E', 800: '#1F5A3E' },
          'half-am':     { 100: '#D7E8E5', 500: '#3F8A8A', 800: '#1F5550' },
          'half-pm':     { 100: '#D9E8F0', 500: '#5598C6', 800: '#1F4965' },
          special:       { 100: '#E6E1D4', 500: '#88560C', 800: '#665010' },
          maternity:     { 100: '#EDDDE3', 500: '#B86472', 800: '#6E2E3A' },
          paternity:     { 100: '#D7E5F0', 500: '#3D55A0', 800: '#1F3A66' },
          'comp-holiday':{ 100: '#E0DAEA', 500: '#7A6BA8', 800: '#3A2E5C' },
          absence:       { 100: '#ECEAE3', 500: '#6B6657', 800: '#33312A' },
          other:         { 100: '#D7E5F0', 500: '#5598C6', 800: '#1F4965' },
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
        'clock-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.55' },
        },
        'colon-blink': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        'border-breathe-success': {
          '0%, 100%': { borderLeftColor: 'rgb(47 143 94 / 1)' },
          '50%':      { borderLeftColor: 'rgb(47 143 94 / 0.55)' },
        },
        'border-breathe-warning': {
          '0%, 100%': { borderLeftColor: 'rgb(136 86 12 / 1)' },
          '50%':      { borderLeftColor: 'rgb(136 86 12 / 0.55)' },
        },
        'progress-stripe': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'badge-pop': {
          '0%':   { transform: 'scale(0.85)', opacity: '0' },
          '60%':  { transform: 'scale(1.06)', opacity: '1' },
          '100%': { transform: 'scale(1)',    opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 180ms cubic-bezier(0.2, 0, 0, 1)',
        'fade-in':  'fade-in 120ms cubic-bezier(0.2, 0, 0, 1)',
        'fade-in-soft':           'fade-in 200ms ease-out',
        'clock-pulse':            'clock-pulse 1s ease-in-out infinite',
        'colon-blink':            'colon-blink 1s ease-in-out infinite',
        'border-breathe-success': 'border-breathe-success 2.4s ease-in-out infinite',
        'border-breathe-warning': 'border-breathe-warning 2.4s ease-in-out infinite',
        'progress-stripe':        'progress-stripe 1.2s ease-in-out infinite',
        'badge-pop':              'badge-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
