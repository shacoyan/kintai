import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useTenant } from '../../hooks/useTenant';
import { StoreSelector } from '../Store/StoreSelector';
import LeaveTenantButton from '../Tenant/LeaveTenantButton';
import { TenantSwitcher } from '../Tenant/TenantSwitcher';
import { Badge, Button } from '../ui';

export interface UserMenuPopoverProps {
  showRoleBadge?: boolean;
  showStoreSelector?: boolean;
  showThemeToggle?: boolean;
}

const THEME_CYCLE = ['light', 'dark', 'system'] as const;
type ThemeValue = (typeof THEME_CYCLE)[number];

const THEME_ICONS: Record<ThemeValue, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_CURRENT_LABELS: Record<ThemeValue, string> = {
  light: 'ライト',
  dark: 'ダーク',
  system: 'システム',
};

export function UserMenuPopover({
  showRoleBadge = true,
  showStoreSelector = true,
  showThemeToggle = true,
}: UserMenuPopoverProps): JSX.Element {
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { myRole } = useTenant();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    function handleEscapeKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleEscapeKeyDown);
    return () => {
      document.removeEventListener('keydown', handleEscapeKeyDown);
    };
  }, [isMenuOpen]);

  const currentIndex = THEME_CYCLE.indexOf(theme as ThemeValue);
  const nextTheme = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
  const ThemeIcon = THEME_ICONS[theme as ThemeValue] ?? Monitor;

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="ユーザーメニュー"
        className="p-2 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 motion-safe:transition-colors duration-150 ease-out"
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls="user-menu-popover"
      >
        <User size={18} />
      </button>
      {isMenuOpen && (
        <div
          id="user-menu-popover"
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white shadow-[0_12px_28px_rgba(0,0,0,0.16)] border border-stone-200 dark:bg-stone-900 dark:border-stone-800 py-2 z-50"
        >
          <div className="px-4 py-2 text-xs text-stone-500 dark:text-stone-400" role="menuitem">
            <TenantSwitcher />
          </div>
          {showStoreSelector && (
            <div className="px-4 py-2" role="menuitem">
              <StoreSelector />
            </div>
          )}
          <div className="border-t border-stone-200 dark:border-stone-800 my-1" aria-hidden="true" />
          {user?.email && (
            <div className="px-4 py-2 text-sm text-stone-700 dark:text-stone-300 truncate" role="menuitem">
              {user.email}
            </div>
          )}
          {showRoleBadge && (myRole === 'owner' || myRole === 'manager') && (
            <div className="px-4 py-1.5" role="menuitem">
              {myRole === 'owner' ? (
                <Badge tone="primary" withDot>
                  Owner
                </Badge>
              ) : (
                <Badge tone="info" withDot>
                  Manager
                </Badge>
              )}
            </div>
          )}
          <div className="border-t border-stone-200 dark:border-stone-800 my-1" aria-hidden="true" />
          <Link
            to="/tenant"
            role="menuitem"
            onClick={() => setIsMenuOpen(false)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 motion-safe:transition-colors duration-150 ease-out"
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
            ワークスペースを切替
          </Link>
          {showThemeToggle && (
            <button
              type="button"
              role="menuitem"
              aria-label={`テーマ切替（現在: ${THEME_CURRENT_LABELS[theme as ThemeValue]} / クリックで ${THEME_CURRENT_LABELS[nextTheme]}）`}
              title={`現在: ${THEME_CURRENT_LABELS[theme as ThemeValue]} → クリックで ${THEME_CURRENT_LABELS[nextTheme]}`}
              onClick={() => setTheme(nextTheme)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 motion-safe:transition-colors duration-150 ease-out"
            >
              <ThemeIcon size={16} aria-hidden="true" />
              テーマ: {THEME_CURRENT_LABELS[theme as ThemeValue]} → {THEME_CURRENT_LABELS[nextTheme]}
            </button>
          )}
          <div className="px-4 py-2" role="menuitem">
            <LeaveTenantButton />
          </div>
          <div className="border-t border-stone-200 dark:border-stone-800 my-1" aria-hidden="true" />
          <div className="px-4 py-2" role="menuitem">
            <Button
              variant="tertiary"
              size="sm"
              onClick={signOut}
              iconLeft={<LogOut size={16} />}
            >
              ログアウト
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
