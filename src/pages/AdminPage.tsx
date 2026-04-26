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

  if (myRole !== 'owner' && myRole !== 'manager') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        管理ダッシュボード
      </h1>
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
