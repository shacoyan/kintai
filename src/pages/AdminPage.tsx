import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';
import { PageSkeleton } from '../components/ui';

export function AdminPage() {
  const [currentMonth] = useState(() => new Date());
  const { currentTenant, myRole } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;

  if (myRole === null) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <PageSkeleton />
      </div>
    );
  }

  if (myRole !== 'owner' && myRole !== 'manager') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        店舗ダッシュボード
      </h1>
      <p className="text-sm text-neutral-500 tabular-nums">{format(currentMonth, 'yyyy年M月', { locale: ja })}</p>
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
