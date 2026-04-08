import { Navigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';

export function AdminPage() {
  const { currentTenant, myRole } = useTenant();
  // RequireTenant ガードにより currentTenant は必ず存在する
  const tenantId = currentTenant!.id;

  if (myRole !== 'owner' && myRole !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">管理ダッシュボード</h1>
      <AdminDashboard tenantId={tenantId} />
    </div>
  );
}
