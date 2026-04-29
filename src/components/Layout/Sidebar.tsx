import { Link, useLocation } from 'react-router-dom';
import { Clock, List, Calendar, LayoutDashboard, LogOut, ArrowLeftRight, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../hooks/useTenant';
import { Badge, BrandMark } from '../ui';
import LeaveTenantButton from '../Tenant/LeaveTenantButton';

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
      className={`flex items-center gap-3 px-3 h-10 rounded-lg text-sm motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 ${
        active
          ? 'bg-primary-50 text-primary-700'
          : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
      }`}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 py-2 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
      {label}
    </p>
  );
}

export function Sidebar() {
  const { user, signOut } = useAuth();
  const { myRole } = useTenant();
  const isManagerial = myRole === 'owner' || myRole === 'manager';

  return (
    <div role="navigation" aria-label="メインナビゲーション" className="h-full flex flex-col p-4 gap-2">
      <div className="flex items-center justify-between h-12 px-1">
        <div className="flex items-center gap-2">
          <BrandMark size="md" color="currentColor" className="text-primary-700" />
          <span className="font-serif-jp text-xl font-semibold text-primary-700">
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

      <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />

      <SectionLabel label="メイン" />
      <NavItem to="/" icon={Clock} label="打刻" />
      <NavItem to="/history" icon={List} label="履歴" />
      <NavItem to="/shift" icon={Calendar} label="シフト" />

      {isManagerial && (
        <>
          <SectionLabel label="管理" />
          <NavItem to="/admin" icon={LayoutDashboard} label="ダッシュボード" />
        </>
      )}

      <div className="flex-1" />

      <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />

      <div className="flex flex-col gap-2">
        <NavItem to="/tenant" icon={ArrowLeftRight} label="ワークスペースを切替" />
        <LeaveTenantButton />
      </div>

      <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />

      <div className="px-1 py-2 flex flex-col gap-2">
        {user?.email && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate" title={user.email}>
            {user.email}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="flex items-center gap-2 px-3 h-10 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
        >
          <LogOut size={16} aria-hidden="true" />
          ログアウト
        </button>
      </div>
    </div>
  );
}
