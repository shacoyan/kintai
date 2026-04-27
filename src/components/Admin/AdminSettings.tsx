import { RoleManagementSection } from './RoleManagementSection';
import { OwnerTransferSection } from './OwnerTransferSection';
import { TenantDeleteSection } from './TenantDeleteSection';

interface AdminSettingsProps {
  tenantId: string;
}

/**
 * 管理者用「設定」タブの親コンポーネント。
 *
 * 役割:
 *   - Loop 11b Phase 1 で導入。AdminDashboard.tsx から呼ばれる単一のシェル。
 *   - 内部に 3 サブセクションを縦積みで配置:
 *       1. RoleManagementSection      (Engineer C / L11b-3 役職時給)
 *       2. OwnerTransferSection       (Engineer E / L11b-5 オーナー権限移譲) ※後続 commit で追加
 *       3. TenantDeleteSection        (Engineer D / L11b-4 テナント soft delete) ※後続 commit で追加
 *   - 危険操作 (移譲 / 削除) は最下部に配置し、各サブセクション側で危険色装飾を行う。
 *
 * 競合回避ルール (Tech Lead 設計書 §2-3):
 *   - C がこのシェルを最初に commit。
 *   - D / E は merge 後に「import 1 行 + JSX 1 行」を所定マーカー付近に追加するのみ。
 *   - 中段の安全セクション (RoleManagementSection) は触らない。
 */
export function AdminSettings({ tenantId }: AdminSettingsProps) {
  return (
    <div className="space-y-6">
      {/* --- Safe section: 役職管理 (Engineer C) --- */}
      <RoleManagementSection tenantId={tenantId} />

      {/* --- Danger zone: オーナー権限移譲 (Engineer E / L11b-5) --- */}
      <OwnerTransferSection tenantId={tenantId} />

      {/* --- Danger zone: テナント削除 (Engineer D / L11b-4) --- */}
      <TenantDeleteSection tenantId={tenantId} />
    </div>
  );
}
