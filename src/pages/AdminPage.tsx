import { Navigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';

export function AdminPage() {
  const { currentTenant, myRole, loading } = useTenant();

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (myRole !== 'owner') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">管理ダッシュボード</h1>
      {currentTenant?.id ? (
        <AdminDashboard tenantId={currentTenant.id} />
      ) : (
        <p className="text-gray-500 text-center py-8">テナントが設定されていません</p>
      )}
    </div>
  );
}
