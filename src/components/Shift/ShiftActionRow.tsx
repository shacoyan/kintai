import { useState } from 'react';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { Spinner } from '../ui/Spinner';
import type { Shift } from '../../types';
import { formatSupabaseError } from '../../lib/errors';
import { formatTimeRange } from '../../utils/formatTimeRange';

export interface ShiftActionRowProps {
  shift: Shift;
  memberName?: string;
  storeName?: string;
  showStoreBadge?: boolean;
  canManage: boolean;
  userColor?: string;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
  onTentativeApprove?: (id: string) => Promise<void>;
  onCancelTentative?: (id: string) => Promise<void>;
  onRevertToTentative?: (id: string) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onModify?: (shift: Shift) => void;
  onDelete?: (id: string) => Promise<void>;
  onMutated?: () => void;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:   { label: '申請中', className: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300' },
  tentative: { label: '仮承認', className: 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-300' },
  approved:  { label: '本承認', className: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300' },
  rejected:  { label: '却下',   className: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300' },
  modified:  { label: '修正',   className: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300' },
  cancelled: { label: '取消',   className: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700/40 dark:text-neutral-300' },
};

const stripBorder = (cls: string) =>
  cls.split(/\s+/).filter(c => !c.startsWith('border-') && !c.startsWith('dark:border-')).join(' ');

export function ShiftActionRow(props: ShiftActionRowProps) {
  const {
    shift,
    memberName,
    storeName,
    showStoreBadge,
    canManage,
    userColor,
    onApprove,
    onReject,
    onTentativeApprove,
    onCancelTentative,
    onRevertToTentative,
    onRestore,
    onModify,
    onDelete,
    onMutated,
  } = props;

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: () => Promise<void>) => {
    setProcessing(true);
    setError(null);
    try {
      await action();
      onMutated?.();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setProcessing(false);
    }
  };

  const badge = STATUS_BADGE[shift.status] ?? { label: shift.status, className: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700/40 dark:text-neutral-300' };

  const actionMenuItems: ActionMenuItem[] = [];
  if (canManage) {
    if (shift.status === 'pending') {
      if (onApprove) actionMenuItems.push({ key: 'approve', label: '本承認', onSelect: () => handleAction(() => onApprove(shift.id)) });
      if (onModify) actionMenuItems.push({ key: 'modify', label: '修正', onSelect: () => onModify(shift), tone: 'primary' });
      if (onReject) actionMenuItems.push({ key: 'reject', label: '却下', onSelect: () => handleAction(() => onReject(shift.id)), tone: 'danger' });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    } else if (shift.status === 'tentative') {
      if (onCancelTentative) actionMenuItems.push({ key: 'cancel-tentative', label: '仮承認取消', onSelect: () => handleAction(() => onCancelTentative(shift.id)), tone: 'danger' });
      if (onModify) actionMenuItems.push({ key: 'modify', label: '修正', onSelect: () => onModify(shift), tone: 'primary' });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    } else if (shift.status === 'approved') {
      if (onRevertToTentative) actionMenuItems.push({ key: 'revert-to-tentative', label: '仮承認に戻す', onSelect: () => handleAction(() => onRevertToTentative(shift.id)), tone: 'danger' });
      if (onModify) actionMenuItems.push({ key: 'modify', label: '修正', onSelect: () => onModify(shift), tone: 'primary' });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    } else if (shift.status === 'modified') {
      if (onApprove) actionMenuItems.push({ key: 'approve', label: '本承認', onSelect: () => handleAction(() => onApprove(shift.id)) });
      if (onTentativeApprove) actionMenuItems.push({ key: 'tentative', label: '仮承認', onSelect: () => handleAction(() => onTentativeApprove(shift.id)) });
      if (onReject) actionMenuItems.push({ key: 'reject', label: '却下', onSelect: () => handleAction(() => onReject(shift.id)), tone: 'danger' });
      if (onModify) actionMenuItems.push({ key: 'modify', label: '修正', onSelect: () => onModify(shift), tone: 'primary' });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    } else if (shift.status === 'rejected') {
      if (onRestore) actionMenuItems.push({ key: 'restore', label: '復元', onSelect: () => handleAction(() => onRestore(shift.id)) });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    } else if (shift.status === 'cancelled') {
      if (onRestore) actionMenuItems.push({ key: 'restore', label: '復元', onSelect: () => handleAction(() => onRestore(shift.id)) });
      if (onDelete) actionMenuItems.push({ key: 'delete', label: '削除', onSelect: () => handleAction(() => onDelete(shift.id)), tone: 'danger' });
    }
  }

  const inlineButtonClass = 'px-2.5 py-1 min-h-[36px] text-xs font-medium text-white bg-success-600 rounded hover:bg-success-700 dark:hover:bg-success-500 disabled:opacity-50 motion-safe:transition-colors duration-120';

  const renderInlineButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      className={inlineButtonClass}
      onClick={onClick}
      disabled={processing}
    >
      {label}
    </button>
  );

  const timeStr = formatTimeRange(shift.start_time, shift.end_time);
  const hasOriginal = shift.original_start_time && shift.original_end_time;
  const originalTimeStr = hasOriginal ? formatTimeRange(shift.original_start_time!, shift.original_end_time!) : null;

  const cardColorClass = userColor ? stripBorder(userColor) : 'bg-neutral-50 dark:bg-neutral-800/40 text-neutral-900 dark:text-neutral-100';

  return (
    <div>
      <div className={`rounded-lg p-3 shadow-sm ${cardColorClass}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            {memberName && (
              <span className="font-medium truncate">
                {memberName}
              </span>
            )}

            {showStoreBadge && storeName && (
              <span className="inline-flex self-start px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-50 text-info-700 dark:bg-info-900/30 dark:text-info-300">
                {storeName}
              </span>
            )}

            <span className="tabular-nums text-xs">
              {timeStr}
            </span>

            {hasOriginal && originalTimeStr && (
              <span className="text-[10px] opacity-75">
                (元: {originalTimeStr})
              </span>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className}`}>
              {badge.label}
            </span>

            <div className="flex items-center gap-2">
              {canManage && processing && (
                <Spinner size="sm" />
              )}

              {canManage && !processing && shift.status === 'pending' && onTentativeApprove && (
                renderInlineButton('仮承認', () => handleAction(() => onTentativeApprove(shift.id)))
              )}

              {canManage && !processing && shift.status === 'tentative' && onApprove && (
                renderInlineButton('本承認', () => handleAction(() => onApprove(shift.id)))
              )}

              {canManage && actionMenuItems.length > 0 && (
                <ActionMenu
                  items={actionMenuItems}
                  align="end"
                  bottomSheetTitle={`${memberName ?? '不明'} ${shift.date}`}
                  disabled={processing}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-danger-600 dark:text-danger-400 px-2 pt-1">
          {error}
        </div>
      )}
    </div>
  );
}
