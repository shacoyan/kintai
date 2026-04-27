import { useState } from 'react';
import type { Shift, Store } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';

interface ShiftEditModalProps {
  shift: Shift;
  memberName?: string;
  canManageTenant: boolean;
  onModify: (shiftId: string, startTime: string, endTime: string, storeId?: string) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
  onApprove?: (shiftId: string) => Promise<void>;
  onReject?: (shiftId: string) => Promise<void>;
  onClose: () => void;
  onRefresh: () => void;
  selectableStores: Store[];
  storeName?: string;
  canManageStore: boolean;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending: { text: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  approved: { text: '承認済', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { text: '却下', className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  modified: { text: '修正済', className: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300' },
  cancelled: { text: '取消', className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700/30 dark:text-neutral-400' },
};

export function ShiftEditModal({ shift, memberName, canManageTenant, onModify, onDelete, onApprove, onReject, onClose, onRefresh, selectableStores, storeName, canManageStore }: ShiftEditModalProps) {
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
          {canManageTenant && canManageStore && shift.status === 'pending' && onApprove && (
            <Button
              onClick={() => handleAction(() => onApprove(shift.id))}
              disabled={processing}
              variant="primary"
              className="bg-success-600 hover:bg-success-700"
            >
              承認
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
          {canManageTenant && canManageStore && (
            <Button
              onClick={() => setMode('edit')}
              variant="primary"
            >
              修正
            </Button>
          )}
          {canManageTenant && canManageStore && (
            <Button
              onClick={() => setMode('confirmDelete')}
              variant="danger"
            >
              削除
            </Button>
          )}
          {canManageTenant && !canManageStore && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">この店舗の管理権限がありません</p>
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
            variant="primary"
          >
            {processing ? '処理中...' : '修正を確定'}
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
            variant="danger"
          >
            {processing ? '処理中...' : '削除する'}
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
        <div className="p-2 bg-danger-50 border border-danger-200 dark:bg-danger-900/30 dark:border-danger-700 rounded text-sm text-danger-600 dark:text-danger-300 mb-3">
          {error}
        </div>
      )}

      {mode === 'view' && (
        <div className="space-y-4">
          {storeName && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">店舗: <span className="font-medium text-neutral-700 dark:text-neutral-300">{storeName}</span></p>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">開始</p>
              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{shift.start_time.slice(0, 5)}</p>
            </div>
            <span className="text-neutral-400 dark:text-neutral-500">→</span>
            <div className="flex-1">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">終了</p>
              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{shift.end_time.slice(0, 5)}</p>
            </div>
          </div>
          {shift.note && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">メモ: {shift.note}</p>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <>
        {selectableStores.length >= 1 && (
          <div className="mb-3">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">店舗</label>
            <select
              value={editStoreId ?? ''}
              onChange={(e) => setEditStoreId(e.target.value || null)}
              className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
            >
              {selectableStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">開始時刻</label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">終了時刻</label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
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
