import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';

/**
 * Loop15: カレンダーの preference アイテムを直接押したときに開く時間変更モーダル。
 * Loop16-C: preference を optional 化し、新規申請モードでも再利用できるようにする。
 *
 * - 既存 ShiftPreferenceForm を BottomSheet 内で再利用するだけのラッパー。
 * - 呼び出し側 (ShiftPage) で「自分の preference か」を判定してから開く想定。
 * - preference 未指定時は newDate を必ず渡すこと（新規申請モード）。
 */
export interface PreferenceTimeEditModalProps {
  /** 既存編集時の preference。新規申請時は undefined。 */
  preference?: ShiftPreference;
  /** 新規申請モード用の対象日付（preference 未指定時に使用）。 */
  newDate?: string;
  presets: ShiftPreset[];
  defaultStoreId: string | null;
  selectableStores: Store[];
  isDeadlinePassed?: boolean;
  canBypassDeadline?: boolean;
  onSubmit: (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeId?: string,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function PreferenceTimeEditModal({
  preference,
  newDate,
  presets,
  selectableStores,
  defaultStoreId,
  isDeadlinePassed = false,
  canBypassDeadline = false,
  onSubmit,
  onDelete,
  onClose,
}: PreferenceTimeEditModalProps) {
  const targetDate = preference?.date ?? newDate;
  if (!targetDate) {
    // Loop16-C: 不正呼び出しを防ぐためのガード。preference / newDate のどちらも無い場合は何もしない。
    return null;
  }
  const title = preference
    ? `${targetDate} のシフト申請`
    : `${targetDate} の新規シフト申請`;
  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title={title}
    >
      <ShiftPreferenceForm
        date={targetDate}
        existingPreference={preference}
        presets={presets}
        selectableStores={selectableStores}
        defaultStoreId={defaultStoreId}
        isDeadlinePassed={isDeadlinePassed}
        canBypassDeadline={canBypassDeadline}
        onSubmit={onSubmit}
        onDelete={onDelete}
        onCancel={onClose}
      />
    </BottomSheet>
  );
}
