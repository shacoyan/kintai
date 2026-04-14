import { useState, useEffect } from 'react';
import { useShiftPreset } from '../../hooks/useShiftPreset';
import { useToast } from '../../contexts/ToastContext';

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
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">シフトプリセット</h2>
        <p className="mt-1 text-sm text-gray-500">よく使う時間帯を登録すると、スタッフがシフト申請時にワンタップで入力できます</p>
      </div>

      {/* 追加フォーム */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">プリセット名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例: 早番"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">開始</label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">終了</label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
      <div className="divide-y divide-gray-200">
        {loading && presets.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : presets.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">プリセットが未登録です</div>
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-sm font-medium">
                  {preset.name}
                </span>
                <span className="text-sm text-gray-600">
                  {preset.start_time.slice(0, 5)} - {preset.end_time.slice(0, 5)}
                </span>
              </div>
              <button
                onClick={() => handleDelete(preset.id)}
                className="px-3 py-1 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition"
              >
                削除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
