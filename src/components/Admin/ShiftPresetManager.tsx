import { useState, useEffect } from 'react';
import { Clock, CalendarClock, Trash2, Pencil, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { useShiftPreset } from '../../hooks/useShiftPreset';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Card, Button, Badge, Input, Select, PageSkeleton, EmptyState, Heading } from '../ui';

interface ShiftPresetManagerProps {
  tenantId: string;
  storeId: string | null;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const TIME_OPTION_OBJECTS = TIME_OPTIONS.map((t) => ({ value: t, label: t }));

export function ShiftPresetManager({ tenantId, storeId }: ShiftPresetManagerProps) {
  const { showToast } = useToast();
  const { presets, loading, fetchPresets, addPreset, deletePreset, updatePreset, reorderPresets } = useShiftPreset(tenantId, storeId);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<'store' | 'tenant'>(storeId ? 'store' : 'tenant');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editStartTime, setEditStartTime] = useState('09:00');
  const [editEndTime, setEditEndTime] = useState('17:00');
  const [editScope, setEditScope] = useState<'store' | 'tenant'>('store');

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  useEffect(() => {
    setScope(storeId ? 'store' : 'tenant');
  }, [storeId]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const effectiveScope: 'store' | 'tenant' = storeId == null ? 'tenant' : scope;
      await addPreset(name.trim(), startTime, endTime, effectiveScope);
      setName('');
      showToast('プリセットを追加しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePreset(id);
      showToast('プリセットを削除しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const startEdit = (preset: { id: string; name: string; start_time: string; end_time: string; store_id: string | null }) => {
    setEditingId(preset.id);
    setEditName(preset.name);
    setEditStartTime(preset.start_time.slice(0, 5));
    setEditEndTime(preset.end_time.slice(0, 5));
    setEditScope(preset.store_id ? 'store' : 'tenant');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await updatePreset(editingId, editName.trim(), editStartTime, editEndTime, editScope);
      showToast('プリセットを更新しました', 'success');
      setEditingId(null);
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const moveUp = async (index: number) => {
    if (index <= 0) return;
    const ordered = [...presets];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    try {
      await reorderPresets(ordered.map((p) => p.id));
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const moveDown = async (index: number) => {
    if (index >= presets.length - 1) return;
    const ordered = [...presets];
    [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
    try {
      await reorderPresets(ordered.map((p) => p.id));
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  return (
    <Card padding="none">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
        <Heading level={2}>シフトプリセット</Heading>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">よく使う時間帯を登録すると、スタッフがシフト申請時にワンタップで入力できます</p>
      </div>

      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="w-full md:flex-1 md:min-w-[120px]">
            <Input
              label="プリセット名"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 早番"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:contents">
            <div>
              <Select
                label="開始"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                options={TIME_OPTION_OBJECTS}
              />
            </div>
            <div>
              <Select
                label="終了"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                options={TIME_OPTION_OBJECTS}
              />
            </div>
          </div>
          <div className="w-full md:w-auto">
            <Select
              label="適用範囲"
              value={storeId == null ? 'tenant' : scope}
              onChange={(e) => setScope(e.target.value as 'store' | 'tenant')}
              disabled={storeId == null}
              options={[
                { value: 'tenant', label: '全店舗共通' },
                { value: 'store', label: '店舗別' },
              ]}
            />
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={handleAdd}
            disabled={saving || !name.trim()}
            loading={saving}
            className="w-full md:w-auto"
          >
            追加
          </Button>
        </div>
      </div>

      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {loading && presets.length === 0 ? (
          <PageSkeleton />
        ) : presets.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="w-12 h-12 text-neutral-400 dark:text-neutral-500" />}
            title="プリセットが未登録です"
            description="よく使う時間帯を登録すると、スタッフがシフト申請時にワンタップで入力できます"
          />
        ) : (
          presets.map((preset, index) => (
            <div key={preset.id} className="px-6 py-3 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-800/50 motion-safe:transition-colors">
              {editingId === preset.id ? (
                <div className="flex flex-wrap items-end gap-3 flex-1">
                  <div className="flex-1 min-w-[120px]">
                    <Input
                      label="プリセット名"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="例: 早番"
                    />
                  </div>
                  <div>
                    <Select
                      label="開始"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      options={TIME_OPTION_OBJECTS}
                    />
                  </div>
                  <div>
                    <Select
                      label="終了"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      options={TIME_OPTION_OBJECTS}
                    />
                  </div>
                  <div>
                    <Select
                      label="適用範囲"
                      value={storeId == null ? 'tenant' : editScope}
                      onChange={(e) => setEditScope(e.target.value as 'store' | 'tenant')}
                      disabled={storeId == null}
                      options={[
                        { value: 'tenant', label: '全店舗共通' },
                        { value: 'store', label: '店舗別' },
                      ]}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveEdit}
                    iconLeft={<Save className="w-3.5 h-3.5" />}
                  >
                    保存
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={cancelEdit}
                    iconLeft={<X className="w-3.5 h-3.5" />}
                  >
                    キャンセル
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Badge tone="primary">
                      {preset.name}
                    </Badge>
                    <span className="text-sm text-neutral-600 dark:text-neutral-300 inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {preset.start_time.slice(0, 5)} - {preset.end_time.slice(0, 5)}
                    </span>
                    <Badge tone={preset.store_id ? 'primary' : 'neutral'}>
                      {preset.store_id ? '店舗別' : '全店舗共通'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => startEdit(preset)}
                      iconLeft={<Pencil className="w-3.5 h-3.5" />}
                    >
                      編集
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      iconLeft={<ArrowUp className="w-3.5 h-3.5" />}
                      aria-label="上へ移動"
                    >
                      <span className="sr-only">上へ移動</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => moveDown(index)}
                      disabled={index === presets.length - 1}
                      iconLeft={<ArrowDown className="w-3.5 h-3.5" />}
                      aria-label="下へ移動"
                    >
                      <span className="sr-only">下へ移動</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(preset.id)}
                      iconLeft={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      削除
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
