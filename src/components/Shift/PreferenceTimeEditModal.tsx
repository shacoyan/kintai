import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';

/**
 * Loop15: カレンダーの preference アイテムを直接押したときに開く時間変更モーダル。
 *
 * - 既存 ShiftPreferenceForm を BottomSheet 内で再利用するだけのラッパー。
 * - 呼び出し側 (ShiftPage) で「自分の preference か」を判定してから開く想定。
 *   他人の preference の場合は従来通り setSelectedDate でサイドバー表示に流す。
 */
export interface PreferenceTimeEditModalProps {
  preference: ShiftPreference;
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
  presets,
  selectableStores,
  defaultStoreId,
  isDeadlinePassed = false,
  canBypassDeadline = false,
  onSubmit,
  onDelete,
  onClose,
}: PreferenceTimeEditModalProps) {
  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title={`${preference.date} のシフト申請`}
    >
      <ShiftPreferenceForm
        date={preference.date}
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
