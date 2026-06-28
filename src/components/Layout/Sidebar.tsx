import { Link, useLocation } from 'react-router-dom';
import { Clock, List, Calendar, LayoutDashboard, CheckSquare, FolderKanban, TrendingUp, FileText, type LucideIcon } from 'lucide-react';
import { useTenant } from '../../hooks/useTenant';
import { useCan } from '../../lib/permissions/useCan';
import { Badge, BrandMark } from '../ui';

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
}) {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 h-9 rounded-md text-sm motion-safe:transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900 ${
        active
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium'
          : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
      }`}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 mt-4 mb-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
      {label}
    </p>
  );
}

export function Sidebar() {
  const { myRole } = useTenant();
  const can = useCan();
  // C2 viewManagerialNav（ナビ「管理」表示・UI のみ）。挙動不変。
  // ※下の Owner/Manager バッジは myRole の表示ラベルなので据え置き（§4.5）。
  const isManagerial = can('viewManagerialNav');

  return (
    <nav aria-label="メインナビゲーション" className="h-full flex flex-col p-3 gap-1.5">
      <div className="flex items-center justify-between h-12 px-1">
        <div className="flex items-center gap-2">
          <BrandMark size="md" color="currentColor" className="text-blue-600 dark:text-blue-400" />
          <span className="font-serif-jp text-xl font-semibold text-stone-900 dark:text-stone-100">
            kintai
          </span>
        </div>
        {myRole === 'owner' && (
          <Badge tone="primary" withDot>
            Owner
          </Badge>
        )}
        {myRole === 'manager' && (
          <Badge tone="info" withDot>
            Manager
          </Badge>
        )}
      </div>

      <div className="border-t border-stone-200 dark:border-stone-800 my-1" />

      <SectionLabel label="メイン" />
      <NavItem to="/" icon={Clock} label="打刻" />
      <NavItem to="/history" icon={List} label="履歴" />
      <NavItem to="/shift" icon={Calendar} label="シフト" />
      <NavItem to="/tasks" icon={CheckSquare} label="タスク" />
      <NavItem to="/sales" icon={TrendingUp} label="売上" />
      <NavItem to="/reports" icon={FileText} label="日報" />
      <NavItem to="/projects" icon={FolderKanban} label="プロジェクト" />

      {isManagerial && (
        <>
          <SectionLabel label="管理" />
          <NavItem to="/admin" icon={LayoutDashboard} label="ダッシュボード" />
        </>
      )}

      <div className="flex-1" />
    </nav>
  );
}
