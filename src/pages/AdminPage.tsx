import { Navigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import { useCan } from '../lib/permissions/useCan';
import { AdminDashboard } from '../components/Admin/AdminDashboard';
import { AdminSkeleton } from '../components/ui';

export function AdminPage() {
  const { currentTenant, myRole } = useTenant();
  const can = useCan();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;

  if (myRole === null) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <AdminSkeleton />
      </div>
    );
  }

  // C1 accessAdmin（admin 内データは各々 RLS で別途強制）。挙動不変。
  if (!can('accessAdmin')) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 py-4 md:py-6">
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
