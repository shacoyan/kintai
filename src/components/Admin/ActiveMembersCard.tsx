import { format, parseISO } from 'date-fns';
import { Users, Coffee } from 'lucide-react';
import { Card, Badge, EmptyState } from '../ui';
import { useActiveAttendance, type ActiveAttendance } from '../../hooks/useActiveAttendance';

interface ActiveMembersCardProps {
  tenantId: string;
  storeId: string | null;
  memberNames: Map<string, string>;
}

export function ActiveMembersCard({ tenantId, storeId, memberNames }: ActiveMembersCardProps) {
  const { active, loading, updatedAt } = useActiveAttendance(tenantId, storeId);

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-primary-600 dark:text-primary-400" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">現在出勤中</h2>
          <Badge tone="primary" withDot>{active.length}名</Badge>
        </div>
        {updatedAt && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            更新: {format(updatedAt, 'HH:mm:ss')}
          </span>
        )}
      </div>

      {loading && active.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-300">読み込み中…</p>
      ) : active.length === 0 ? (
        <EmptyState
          title="現在出勤中のメンバーはいません"
          description={storeId ? '打刻があるとここにリアルタイムで表示されます。' : '店舗を選択してください。'}
        />
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {active.map((row: ActiveAttendance) => (
            <li key={row.recordId} className="py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-success-500 dark:bg-success-400 flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-neutral-900 dark:text-neutral-100 truncate">
                  {memberNames.get(row.userId) ?? '（不明）'}
                </span>
                {row.isOnBreak && (
                  <Badge tone="warning">
                    <Coffee size={12} className="mr-0.5" />
                    休憩中
                  </Badge>
                )}
              </div>
              <span className="text-xs text-neutral-500 dark:text-neutral-300 tabular-nums flex-shrink-0">
                {format(parseISO(row.clockIn), 'HH:mm')}〜
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
