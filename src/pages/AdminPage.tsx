import { Navigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';
import { PageSkeleton } from '../components/ui/Skeleton';

export function AdminPage() {
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

  if (myRole !== 'owner' && myRole !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">管理ダッシュボード</h1>
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
