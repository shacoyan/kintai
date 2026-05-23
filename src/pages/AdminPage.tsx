import { Navigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';
import { AdminSkeleton } from '../components/ui';

export function AdminPage() {
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
    <div className="max-w-[1280px] mx-auto px-4 py-4 md:py-6">
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
