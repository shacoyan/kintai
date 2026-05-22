import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Clock,
  List,
  Calendar,
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useTenant } from '../../hooks/useTenant';
import { BottomSheet } from '../ui/BottomSheet';

interface NavItemDef {
  to: string;
  icon: LucideIcon;
  label: string;
}

// 主 4 列固定 (全 role 共通)
const PRIMARY_ITEMS: NavItemDef[] = [
  { to: '/', icon: Clock, label: '打刻' },
  { to: '/history', icon: List, label: '履歴' },
  { to: '/shift', icon: Calendar, label: 'シフト' },
  { to: '/tasks', icon: CheckSquare, label: 'タスク' },
];

// 「もっと」drawer 内の項目 (全 role 表示)
const MORE_ITEMS_ALL: NavItemDef[] = [
  { to: '/projects', icon: FolderKanban, label: 'プロジェクト' },
];

// 「もっと」drawer 内の項目 (managerial のみ)
const MORE_ITEMS_MANAGERIAL: NavItemDef[] = [
  { to: '/admin', icon: LayoutDashboard, label: '管理' },
];

export function BottomNav() {
  const { pathname } = useLocation();
  const { myRole } = useTenant();
  const isManagerial = myRole === 'owner' || myRole === 'manager';
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const moreItems = isManagerial
    ? [...MORE_ITEMS_ALL, ...MORE_ITEMS_MANAGERIAL]
    : MORE_ITEMS_ALL;

  // 主 4 列のいずれかに該当するルートか
  const isMoreActive = moreItems.some((item) => pathname === item.to);

  return (
    <>
      <ul className="grid h-full grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {PRIMARY_ITEMS.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 h-full min-h-[44px] motion-safe:transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-inset ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                }`}
              >
                <Icon size={20} aria-hidden="true" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isMoreOpen}
            aria-label="もっと"
            className={`flex flex-col items-center justify-center gap-0.5 h-full min-h-[44px] w-full motion-safe:transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-inset ${
              isMoreActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
            }`}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
            <span className="text-[10px] font-medium">もっと</span>
          </button>
        </li>
      </ul>

      <BottomSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        title="メニュー"
      >
        <nav aria-label="追加メニュー">
          <ul className="flex flex-col gap-1">
            {moreItems.map((item) => {
              const active = pathname === item.to;
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setIsMoreOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 h-11 rounded-md text-sm motion-safe:transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ${
                      active
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium'
                        : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </BottomSheet>
    </>
  );
}
