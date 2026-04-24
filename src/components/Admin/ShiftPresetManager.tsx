import { useState, useEffect } from 'react';
import { Clock, CalendarClock, Trash2 } from 'lucide-react';
import { useShiftPreset } from '../../hooks/useShiftPreset';
import { useToast } from '../../contexts/ToastContext';
import { PageSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

interface ShiftPresetManagerProps {
  tenantId: string;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

export function ShiftPresetManager({ tenantId }: ShiftPresetManagerProps) {
  const { showToast } = useToast();
  const { presets, loading, fetchPresets, addPreset, deletePreset } = useShiftPreset(tenantId);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addPreset(name.trim(), startTime, endTime);
      setName('');
      showToast('プリセットを追加しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'プリセットの追加に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePreset(id);
      showToast('プリセットを削除しました', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'プリセットの削除に失敗しました', 'error');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">シフトプリセット</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">よく使う時間帯を登録すると、スタッフがシフト申請時にワンタップで入力できます</p>
      </div>

      {/* 追加フォーム */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">プリセット名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              placeholder="例: 早番"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">開始</label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">終了</label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving ? '追加中...' : '追加'}
          </button>
        </div>
      </div>

      {/* プリセット一覧 */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {loading && presets.length === 0 ? (
          <PageSkeleton />
        ) : presets.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="w-12 h-12 text-slate-400" />}
            title="プリセットが未登録です"
            description="よく使う時間帯を登録すると、スタッフがシフト申請時にワンタップで入力できます"
          />
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                  {preset.name}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {preset.start_time.slice(0, 5)} - {preset.end_time.slice(0, 5)}
                </span>
              </div>
              <button
                onClick={() => handleDelete(preset.id)}
                className="btn-danger inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                削除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
