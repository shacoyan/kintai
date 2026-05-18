import { useState } from 'react';
import type { Shift, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Select, ErrorBanner } from '../ui';

interface ShiftEditModalProps {
  shift: Shift;
  memberName?: string;
  canManageTenant: boolean;
  canManageStore: boolean;
  selectableStores: Store[];
  storeName?: string;
  onModify: (shiftId: string, startTime: string, endTime: string, storeId?: string) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onApprove?: (shiftId: string) => Promise<void>;
  onTentativeApprove?: (shiftId: string) => Promise<void>;
  onCancelTentative?: (shiftId: string) => Promise<void>;
  onReject?: (shiftId: string) => Promise<void>;
  onRestore?: (shiftId: string) => Promise<void>;
  onClose: () => void;
  onRefresh: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending: { text: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  tentative: { text: '仮承認', className: 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-300' },
  approved: { text: '承認済', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { text: '却下', className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  modified: { text: '修正済', className: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300' },
  cancelled: { text: '取消', className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700/30 dark:text-neutral-300' },
};

export function ShiftEditModal({
  shift,
  memberName,
  canManageTenant,
  canManageStore,
  selectableStores,
  storeName,
  onModify,
  onDelete,
  onApprove,
  onTentativeApprove,
  onCancelTentative,
  onReject,
  onRestore,
  onClose,
  onRefresh
}: ShiftEditModalProps) {
  const [startTime, setStartTime] = useState(shift.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(shift.end_time.slice(0, 5));
  const [editStoreId, setEditStoreId] = useState<string | null>(shift.store_id ?? null);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onRefresh();
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setProcessing(false);
    }
  };

  const status = STATUS_LABEL[shift.status] || STATUS_LABEL.pending;

  const renderFooter = () => {
    if (mode === 'view') {
      return (
        <div className="flex flex-wrap gap-2">
          {canManageTenant && canManageStore && shift.status === 'pending' && onTentativeApprove && (
            <Button
              onClick={() => handleAction(() => onTentativeApprove(shift.id))}
              disabled={processing}
              variant="primary"
              className="bg-success-600 dark:bg-success-500 hover:bg-success-700 dark:hover:bg-success-400"
            >
              仮承認
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'pending' && onReject && (
            <Button
              onClick={() => handleAction(() => onReject(shift.id))}
              disabled={processing}
              variant="danger"
            >
              却下
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'tentative' && onApprove && (
            <Button
              onClick={() => handleAction(() => onApprove(shift.id))}
              disabled={processing}
              variant="primary"
              className="bg-success-700 dark:bg-success-600 hover:bg-success-800 dark:hover:bg-success-500"
            >
              本承認
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'tentative' && onCancelTentative && (
            <Button
              onClick={() => handleAction(() => onCancelTentative(shift.id))}
              disabled={processing}
              variant="tertiary"
            >
              差し戻し
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'tentative' && onReject && (
            <Button
              onClick={() => handleAction(() => onReject(shift.id))}
              disabled={processing}
              variant="danger"
            >
              却下
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'approved' && (
            <Button
              onClick={() => setMode('edit')}
              variant="primary"
            >
              修正
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'approved' && (
            <Button
              onClick={() => setMode('confirmDelete')}
              variant="danger"
            >
              削除
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'rejected' && onRestore && (
            <Button
              onClick={() => handleAction(() => onRestore(shift.id))}
              disabled={processing}
              variant="primary"
              className="bg-success-600 dark:bg-success-500 hover:bg-success-700 dark:hover:bg-success-400"
            >
              復活承認
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'rejected' && (
            <Button
              onClick={() => setMode('confirmDelete')}
              variant="danger"
            >
              削除
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'modified' && onTentativeApprove && (
            <Button
              onClick={() => handleAction(() => onTentativeApprove(shift.id))}
              disabled={processing}
              variant="primary"
              className="bg-success-600 dark:bg-success-500 hover:bg-success-700 dark:hover:bg-success-400"
            >
              仮承認
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'modified' && (
            <Button
              onClick={() => setMode('edit')}
              variant="primary"
            >
              再修正
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'modified' && onReject && (
            <Button
              onClick={() => handleAction(() => onReject(shift.id))}
              disabled={processing}
              variant="danger"
            >
              却下
            </Button>
          )}
          {canManageTenant && canManageStore && shift.status === 'modified' && (
            <Button
              onClick={() => setMode('confirmDelete')}
              variant="danger"
            >
              削除
            </Button>
          )}
          {/* Fallback modify/delete for other potential unhandled statuses if necessary, 
              or keeping existing logic for general cases if required. Assuming status is strictly typed. */}
          {!['pending', 'tentative', 'approved', 'rejected', 'modified'].includes(shift.status) && canManageTenant && canManageStore && (
            <>
              <Button onClick={() => setMode('edit')} variant="primary">修正</Button>
              <Button onClick={() => setMode('confirmDelete')} variant="danger">削除</Button>
            </>
          )}
          {canManageTenant && !canManageStore && (
            <p className="text-xs text-neutral-500 dark:text-neutral-300">この店舗の管理権限がありません</p>
          )}
          <Button
            onClick={onClose}
            variant="tertiary"
          >
            閉じる
          </Button>
        </div>
      );
    }

    if (mode === 'edit') {
      return (
        <div className="flex gap-2">
          <Button
            onClick={() => handleAction(() => onModify(shift.id, startTime, endTime, editStoreId ?? undefined))}
            disabled={processing}
            loading={processing}
            variant="primary"
          >
            修正を確定
          </Button>
          <Button
            onClick={() => setMode('view')}
            variant="tertiary"
          >
            戻る
          </Button>
        </div>
      );
    }

    if (mode === 'confirmDelete') {
      return (
        <div className="flex gap-2">
          <Button
            onClick={() => handleAction(() => onDelete(shift.id))}
            disabled={processing}
            loading={processing}
            variant="danger"
          >
            削除する
          </Button>
          <Button
            onClick={() => setMode('view')}
            variant="tertiary"
          >
            戻る
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title={`${shift.date} のシフト`}
      description={memberName}
      footer={renderFooter()}
    >
      <div className="flex justify-end mb-2">
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
          {status.text}
        </span>
      </div>

      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}

      {mode === 'view' && (
        <div className="space-y-4">
          {storeName && (
            <p className="text-xs text-neutral-500 dark:text-neutral-300">店舗: <span className="font-medium text-neutral-700 dark:text-neutral-300">{storeName}</span></p>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-neutral-500 dark:text-neutral-300">開始</p>
              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{shift.start_time.slice(0, 5)}</p>
            </div>
            <span className="text-neutral-400 dark:text-neutral-500">→</span>
            <div className="flex-1">
              <p className="text-xs text-neutral-500 dark:text-neutral-300">終了</p>
              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{shift.end_time.slice(0, 5)}</p>
            </div>
          </div>
          {shift.note && (
            <p className="text-xs text-neutral-500 dark:text-neutral-300">メモ: {shift.note}</p>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <>
          {selectableStores.length >= 1 && (
            <div className="mb-3">
              <Select
                label="店舗"
                value={editStoreId ?? ''}
                onChange={(e) => setEditStoreId(e.target.value || null)}
              >
                {selectableStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="開始時刻"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select
              label="終了時刻"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
        </>
      )}

      {mode === 'confirmDelete' && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          このシフトを削除しますか？この操作は元に戻せません。
        </p>
      )}
    </BottomSheet>
  );
}
