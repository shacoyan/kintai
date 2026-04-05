// FILE: pages/AdminPage.tsx
import { useTenant } from '../hooks/useTenant';
import { AdminDashboard } from '../components/Admin/AdminDashboard';

export function AdminPage() {
  const { currentTenant } = useTenant();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">管理ダッシュボード</h1>
      {currentTenant?.id ? (
        <AdminDashboard tenantId={currentTenant.id} />
      ) : (
        <p className="text-gray-500 text-center py-8">テナントが設定されていません</p>
      )}
    </div>
  );
}
