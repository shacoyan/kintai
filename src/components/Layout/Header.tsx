import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../hooks/useTenant';
import { useTheme } from '../../contexts/ThemeContext';
import { StoreSelector } from '../Store/StoreSelector';
import { Sun, Moon, Monitor } from 'lucide-react';

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const ClipboardIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);

const CogIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

type Theme = 'light' | 'dark' | 'system';

const THEME_CYCLE: Theme[] = ['light', 'dark', 'system'];
const THEME_LABEL: Record<Theme, React.ReactNode> = { light: <Sun className="w-5 h-5" />, dark: <Moon className="w-5 h-5" />, system: <Monitor className="w-5 h-5" /> };
const THEME_TITLE: Record<Theme, string> = { light: 'ライトモード', dark: 'ダークモード', system: 'システム設定' };
const THEME_ARIA: Record<Theme, string> = { light: 'テーマ: 明るい', dark: 'テーマ: 暗い', system: 'テーマ: システム' };

export const Header: React.FC = () => {
  const { user, signOut } = useAuth();
  const { myRole } = useTenant();
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { path: '/', label: 'ダッシュボード', shortLabel: '打刻', icon: <ClockIcon /> },
    { path: '/history', label: '履歴', shortLabel: '履歴', icon: <CalendarIcon /> },
    { path: '/shift', label: 'シフト', shortLabel: 'シフト', icon: <ClipboardIcon /> },
    ...(myRole === 'owner' || myRole === 'manager' ? [{ path: '/admin', label: '管理', shortLabel: '管理', icon: <CogIcon /> }] : []),
  ];

  return (
    <>
      {/* デスクトップヘッダー */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-bold tracking-wide text-slate-900 dark:text-slate-100">
                勤怠管理
              </h1>
              <nav className="hidden md:flex space-x-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition ${
                      isActive(link.path)
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center space-x-4">
              <StoreSelector />
              {user && (
                <span className="hidden md:block text-sm text-slate-500 dark:text-slate-400 truncate max-w-xs">
                  {user.email}
                </span>
              )}
              <button
                onClick={cycleTheme}
                title={THEME_TITLE[theme]}
                aria-label={THEME_ARIA[theme]}
                className="p-2 rounded-md text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900"
              >
                {THEME_LABEL[theme]}
              </button>
              <button
                onClick={() => signOut()}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* モバイルボトムナビ */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-50 safe-area-bottom">
        <div className="flex justify-around items-center h-16">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              aria-current={isActive(link.path) ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive(link.path)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {link.icon}
              <span className="text-[10px] mt-1 font-medium">{link.shortLabel}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
};
