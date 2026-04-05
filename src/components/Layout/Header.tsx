import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../hooks/useTenant';

export const Header: React.FC = () => {
  const { user, signOut } = useAuth();
  const { myRole } = useTenant();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { path: '/', label: 'ダッシュボード' },
    { path: '/history', label: '履歴' },
    ...(myRole === 'owner' ? [{ path: '/admin', label: '管理' }] : []),
  ];

  return (
    <header className="bg-blue-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <h1 className="text-xl font-bold tracking-wide">
              勤怠管理
            </h1>
            <nav className="hidden md:flex space-x-4">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition ${
                    isActive(link.path)
                      ? 'bg-blue-900 text-white'
                      : 'text-blue-100 hover:bg-blue-700 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            {user && (
              <span className="hidden sm:block text-sm text-blue-200 truncate max-w-xs">
                {user.email}
              </span>
            )}
            <button
              onClick={() => signOut()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-blue-800"
            >
              ログアウト
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
