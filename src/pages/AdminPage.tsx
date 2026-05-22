import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';
import { AdminSkeleton, Heading } from '../components/ui';

export function AdminPage() {
  const [currentMonth] = useState(() => new Date());
  const { currentTenant, myRole } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;

  if (myRole === null) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <AdminSkeleton />
      </div>
    );
  }

  if (myRole !== 'owner' && myRole !== 'manager') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <Heading level={1}>
          店舗ダッシュボード
        </Heading>
        <p className="text-sm text-stone-500 tabular-nums mt-1">{format(currentMonth, 'yyyy年M月', { locale: ja })}</p>
      </header>
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
