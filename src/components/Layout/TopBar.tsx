import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { StoreSelector } from '../Store/StoreSelector';

export interface TopBarProps {
  title?: string;
}

const THEME_CYCLE = ['light', 'dark', 'system'] as const;
type ThemeValue = (typeof THEME_CYCLE)[number];

const THEME_ICONS: Record<ThemeValue, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_ARIA_LABELS: Record<ThemeValue, string> = {
  light: 'テーマ: 明るい',
  dark: 'テーマ: 暗い',
  system: 'テーマ: システム',
};

const THEME_TITLES: Record<ThemeValue, string> = {
  light: 'ライトモード',
  dark: 'ダークモード',
  system: 'システム設定',
};

export function TopBar({ title }: TopBarProps) {
  const { theme, setTheme } = useTheme();

  const currentIndex = THEME_CYCLE.indexOf(theme as ThemeValue);
  const nextTheme = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
  const Icon = THEME_ICONS[theme as ThemeValue] ?? Monitor;

  return (
    <div className="flex items-center w-full gap-4">
      {title && (
        <h1 className="text-lg font-semibold text-neutral-900 truncate">
          {title}
        </h1>
      )}
      <div className="flex-1" />
      <StoreSelector />
      <button
        type="button"
        aria-label={THEME_ARIA_LABELS[theme as ThemeValue]}
        title={THEME_TITLES[theme as ThemeValue]}
        onClick={() => setTheme(nextTheme)}
        className="p-2 rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Icon size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
