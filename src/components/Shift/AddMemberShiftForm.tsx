import React, { useState, useRef, memo } from 'react';
import { Plus } from 'lucide-react';
import { Button, Select, ErrorBanner } from '../ui';
import { TenantMember, Store, ShiftPreset } from '../../types';
import { validateShiftTimeRange } from '../../utils/timeRange';

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

interface AddMemberShiftFormProps {
  /** 表示中の日付。呼出元が closure で onAdd に注入する想定で、ここでは使わない (key 差し替え専用) */
  availableMembers: TenantMember[];
  stores: Store[];
  defaultStoreId: string;
  presets: ShiftPreset[];
  onAdd: (userId: string, storeId: string, startTime: string, endTime: string) => Promise<void>;
  onSuccess?: () => void;
}

export const AddMemberShiftForm = memo<AddMemberShiftFormProps>(({
  availableMembers,
  stores,
  defaultStoreId,
  presets,
  onAdd,
  onSuccess,
}) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [userId, setUserId] = useState('');
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [adding, setAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (availableMembers.length === 0) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!userId) {
      setErrorMsg('スタッフを選択してください');
      return;
    }
    if (!storeId) {
      setErrorMsg('店舗を選択してください');
      return;
    }
    if (startTime === endTime) {
      setErrorMsg('開始時刻と終了時刻は異なる必要があります');
      return;
    }

    const timeResult = validateShiftTimeRange(startTime, endTime);
    if (!timeResult.ok) {
      setErrorMsg(timeResult.message);
      return;
    }

    setAdding(true);
    try {
      await onAdd(userId, storeId, startTime, endTime);
      if (detailsRef.current) {
        detailsRef.current.open = false;
      }
      setUserId('');
      setStoreId(defaultStoreId);
      setStartTime('09:00');
      setEndTime('18:00');
      onSuccess?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'シフトの追加に失敗しました');
    } finally {
      setAdding(false);
    }
  };

  const handlePresetClick = (preset: ShiftPreset) => {
    setStartTime(preset.start_time.slice(0, 5));
    setEndTime(preset.end_time.slice(0, 5));
  };

  return (
    <details ref={detailsRef} className="group border-t border-stone-200 dark:border-stone-700">
      <summary className="flex items-center gap-2 p-3 cursor-pointer text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 list-none">
        <Plus className="w-4 h-4" />
        <span className="text-sm font-medium">シフトを追加</span>
      </summary>

      <div className="p-3 border-t border-stone-100 dark:border-stone-800">
        <form onSubmit={handleSubmit} className="space-y-3">
          {errorMsg && (
            <ErrorBanner message={errorMsg} />
          )}

          <Select
            label="スタッフ"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">選択してください</option>
            {availableMembers.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </Select>

          {stores.length >= 2 && (
            <Select
              label="店舗"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">選択してください</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="開始時刻"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>

            <Select
              label="終了時刻"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>

          {presets.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                クイック入力
              </span>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="px-2.5 py-1 text-xs rounded-full border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
                  >
                    {preset.name || `${preset.start_time.slice(0, 5)}-${preset.end_time.slice(0, 5)}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={adding}
            disabled={adding}
            fullWidth
          >
            シフト追加（仮承認）
          </Button>
        </form>
      </div>
    </details>
  );
});
