import { Link, useLocation } from 'react-router-dom';
import { Clock, List, Calendar, LayoutDashboard } from 'lucide-react';
import { useTenant } from '../../hooks/useTenant';

interface NavItemDef {
  to: string;
  icon: typeof Clock;
  label: string;
}

const BASE_ITEMS: NavItemDef[] = [
  { to: '/', icon: Clock, label: '打刻' },
  { to: '/history', icon: List, label: '履歴' },
  { to: '/shift', icon: Calendar, label: 'シフト' },
];

const ADMIN_ITEM: NavItemDef = {
  to: '/admin',
  icon: LayoutDashboard,
  label: '管理',
};

export function BottomNav() {
  const { pathname } = useLocation();
  const { myRole } = useTenant();
  const isManagerial = myRole === 'owner' || myRole === 'manager';

  const items = isManagerial ? [...BASE_ITEMS, ADMIN_ITEM] : BASE_ITEMS;
  const cols = items.length === 4 ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <ul className={`grid h-full ${cols} pb-[env(safe-area-inset-bottom)]`}>
      {items.map((item) => {
        const active = pathname === item.to;
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <Link
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 h-full ${
                active ? 'text-primary-600' : 'text-neutral-500'
              } hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
