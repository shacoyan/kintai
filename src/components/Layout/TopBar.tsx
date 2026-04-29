import { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Monitor, User, LogOut } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { Badge, Button } from '../ui';
import { StoreSelector } from '../Store/StoreSelector';
import { TenantSwitcher } from '../Tenant/TenantSwitcher';
import { NotificationBell } from '../Notification/NotificationBell';

export interface TopBarProps {
  title?: string;
  showRoleBadge?: boolean;
  showStoreSelector?: boolean;
  showThemeToggle?: boolean;
  showNotificationBell?: boolean;
  showUserMenu?: boolean;
  rightSlot?: React.ReactNode;
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

export function TopBar({
  title,
  showRoleBadge = true,
  showStoreSelector = true,
  showThemeToggle = true,
  showNotificationBell = true,
  showUserMenu = true,
  rightSlot,
}: TopBarProps) {
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
    <div className="flex items-center w-full gap-4 flex-wrap">
      <TenantSwitcher />
      {title && (
        <h1 className="text-heading-2 text-neutral-900 dark:text-neutral-50 truncate">
          {title}
        </h1>
      )}
      {showRoleBadge && (myRole === 'owner' || myRole === 'manager') && (
        <span className="hidden lg:inline-flex">
          {myRole === 'owner' ? (
            <Badge tone="primary" withDot>Owner</Badge>
          ) : (
            <Badge tone="info" withDot>Manager</Badge>
          )}
        </span>
      )}
      <div className="flex-1" />
      {rightSlot}
      {showNotificationBell && <NotificationBell />}
      {showStoreSelector && <StoreSelector />}
      {showThemeToggle && (
        <button
          type="button"
          aria-label={`テーマ切替（現在: ${THEME_CURRENT_LABELS[theme as ThemeValue]} / クリックで ${THEME_CURRENT_LABELS[nextTheme]}）`}
          title={`現在: ${THEME_CURRENT_LABELS[theme as ThemeValue]} → クリックで ${THEME_CURRENT_LABELS[nextTheme]}`}
          onClick={() => setTheme(nextTheme)}
          className="p-2 rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ThemeIcon size={18} aria-hidden="true" />
        </button>
      )}
      {showUserMenu && (
        <div className="relative" ref={menuRef}>
          <button
            ref={triggerRef}
            type="button"
            aria-label="ユーザーメニュー"
            className="p-2 rounded-md text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
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
              className="absolute right-0 top-full mt-2 w-56 rounded-md bg-white shadow-lg border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800 py-2 z-50"
            >
              {user?.email && (
                <div className="px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 truncate" role="menuitem">
                  {user.email}
                </div>
              )}
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
      )}
    </div>
  );
}

