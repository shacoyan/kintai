import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, addMonths, endOfMonth } from 'date-fns';
import { LayoutGrid, Trash2, Pencil, Save, X, Power } from 'lucide-react';
import { useShiftFrames } from '../../hooks/useShiftFrames';
import { useShiftPreset } from '../../hooks/useShiftPreset';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { validateShiftTimeRange } from '../../utils/timeRange';
import { formatTimeRange } from '../../utils/formatTimeRange';
import { FRAME_DAY_LABELS } from '../../utils/shiftFrames';
import { Card, Button, Badge, Input, Select, PageSkeleton, EmptyState, Heading } from '../ui';
import type { ShiftFrame } from '../../types';

interface ShiftFrameManagerProps {
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
const TIME_OPTION_SET = new Set(TIME_OPTIONS);
const REQUIRED_COUNT_OPTIONS = Array.from({ length: 50 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}人` }));

export function ShiftFrameManager({ tenantId, storeId }: ShiftFrameManagerProps) {
  const { showToast } = useToast();
  const {
    frames,
    loading,
    fetchFrames,
    addWeeklyFrame,
    addOneOffFrame,
    updateFrame,
    deleteFrame,
  } = useShiftFrames(tenantId, storeId);
  const { presets, fetchPresets } = useShiftPreset(tenantId, storeId);

  // 単発枠一覧は「今日〜3ヶ月先」の範囲を fetch する。毎週テンプレは or() で全件取得される。
  const reloadFrames = useCallback(() => {
    if (!storeId) return;
    const rangeStart = format(new Date(), 'yyyy-MM-dd');
    const rangeEnd = format(endOfMonth(addMonths(new Date(), 2)), 'yyyy-MM-dd');
    return fetchFrames(rangeStart, rangeEnd);
  }, [storeId, fetchFrames]);

  useEffect(() => {
    reloadFrames();
  }, [reloadFrames]);

  useEffect(() => {
    if (storeId === null) return;
    fetchPresets();
  }, [storeId, fetchPresets]);

  // 追加フォーム（毎週テンプレ）
  const [newDayOfWeek, setNewDayOfWeek] = useState<number>(1);
  const [newName, setNewName] = useState('');
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [newRequired, setNewRequired] = useState('2');
  const [savingWeekly, setSavingWeekly] = useState(false);

  // 追加フォーム（単発枠）
  const [oneOffDate, setOneOffDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [oneOffName, setOneOffName] = useState('');
  const [oneOffStart, setOneOffStart] = useState('09:00');
  const [oneOffEnd, setOneOffEnd] = useState('17:00');
  const [oneOffRequired, setOneOffRequired] = useState('2');
  const [savingOneOff, setSavingOneOff] = useState(false);

  // 編集中
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('09:00');
  const [editEnd, setEditEnd] = useState('17:00');
  const [editRequired, setEditRequired] = useState('2');

  const weeklyFramesByDay = useMemo(() => {
    const map = new Map<number, ShiftFrame[]>();
    for (const f of frames) {
      if (f.day_of_week === null) continue;
      const list = map.get(f.day_of_week) ?? [];
      list.push(f);
      map.set(f.day_of_week, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [frames]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const oneOffFrames = useMemo(
    () => frames.filter((f) => f.date !== null && f.date >= todayStr).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0)),
    [frames, todayStr],
  );

  // shift_frames は DB CHECK で15分刻み必須のため、15分刻みに乗らないプリセット（秒指定含む）は
  // 選択肢から除外する（丸めない・toast も出さない。理由は設計参照）。
  const presetOptions = useMemo(() => {
    const isAlignedTime = (t: string) => TIME_OPTION_SET.has(t.slice(0, 5)) && (t.slice(5) === '' || t.slice(5) === ':00');
    const aligned = presets.filter((p) => isAlignedTime(p.start_time) && isAlignedTime(p.end_time));
    if (aligned.length === 0) return [];
    return [
      { value: '', label: 'プリセットから入力' },
      ...aligned.map((p) => ({
        value: p.id,
        label: `${p.name}（${formatTimeRange(p.start_time, p.end_time, { separator: ' - ' })}）`,
      })),
    ];
  }, [presets]);

  if (storeId === null) {
    return (
      <Card padding="md">
        <EmptyState
          icon={<LayoutGrid className="w-12 h-12 text-stone-400 dark:text-stone-500" />}
          title="店舗を選択してください"
          description="シフト枠は店舗ごとに設定します。上部の店舗切替から対象店舗を選んでください。"
        />
      </Card>
    );
  }

  const handleAddWeekly = async () => {
    if (!newName.trim()) return;
    const v = validateShiftTimeRange(newStart, newEnd);
    if (!v.ok) {
      showToast(v.message, 'error');
      return;
    }
    setSavingWeekly(true);
    try {
      await addWeeklyFrame({
        dayOfWeek: newDayOfWeek,
        name: newName.trim(),
        startTime: newStart,
        endTime: newEnd,
        requiredCount: Number(newRequired),
      });
      setNewName('');
      showToast('シフト枠を追加しました', 'success');
      await reloadFrames();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSavingWeekly(false);
    }
  };

  const handleAddOneOff = async () => {
    if (!oneOffName.trim()) return;
    const v = validateShiftTimeRange(oneOffStart, oneOffEnd);
    if (!v.ok) {
      showToast(v.message, 'error');
      return;
    }
    setSavingOneOff(true);
    try {
      await addOneOffFrame({
        date: oneOffDate,
        name: oneOffName.trim(),
        startTime: oneOffStart,
        endTime: oneOffEnd,
        requiredCount: Number(oneOffRequired),
      });
      setOneOffName('');
      showToast('単発シフト枠を追加しました', 'success');
      await reloadFrames();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSavingOneOff(false);
    }
  };

  const startEdit = (frame: ShiftFrame) => {
    setEditingId(frame.id);
    setEditName(frame.name);
    setEditStart(frame.start_time.slice(0, 5));
    setEditEnd(frame.end_time.slice(0, 5));
    setEditRequired(String(frame.required_count));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const v = validateShiftTimeRange(editStart, editEnd);
    if (!v.ok) {
      showToast(v.message, 'error');
      return;
    }
    try {
      await updateFrame(editingId, {
        name: editName.trim(),
        startTime: editStart,
        endTime: editEnd,
        requiredCount: Number(editRequired),
      });
      showToast('シフト枠を更新しました', 'success');
      setEditingId(null);
      await reloadFrames();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const toggleActive = async (frame: ShiftFrame) => {
    try {
      await updateFrame(frame.id, { isActive: !frame.is_active });
      showToast(frame.is_active ? '枠を休止しました' : '枠を有効化しました', 'success');
      await reloadFrames();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFrame(id);
      showToast('シフト枠を削除しました', 'success');
      await reloadFrames();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    }
  };

  // プリセット選択は常に value='' の action 方式（新規 state を持たない）。
  // 適用後は自動でプレースホルダ表示に戻り、同じプリセットの連続選択でも onChange が発火する。
  const renderPresetSelect = (apply: (name: string, start: string, end: string) => void) => {
    if (presetOptions.length === 0) return null;
    return (
      <Select
        label="プリセット"
        value=""
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          const preset = presets.find((p) => p.id === id);
          if (!preset) return;
          apply(preset.name, preset.start_time.slice(0, 5), preset.end_time.slice(0, 5));
        }}
        options={presetOptions}
      />
    );
  };

  const renderFrameRow = (frame: ShiftFrame) => (
    <div key={frame.id} className="px-6 py-3 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-800/50 motion-safe:transition-colors duration-150 ease-out">
      {editingId === frame.id ? (
        <div className="flex flex-wrap items-end gap-3 flex-1">
          <div className="w-full md:w-auto">
            {renderPresetSelect((name, start, end) => {
              setEditName(name);
              setEditStart(start);
              setEditEnd(end);
            })}
          </div>
          <div className="flex-1 min-w-[120px]">
            <Input label="枠名" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="例: 早番" />
          </div>
          <div>
            <Select label="開始" value={editStart} onChange={(e) => setEditStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
          </div>
          <div>
            <Select label="終了" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
          </div>
          <div>
            <Select label="必要人数" value={editRequired} onChange={(e) => setEditRequired(e.target.value)} options={REQUIRED_COUNT_OPTIONS} />
          </div>
          <Button variant="primary" size="sm" onClick={saveEdit} iconLeft={<Save className="w-3.5 h-3.5" />}>保存</Button>
          <Button variant="secondary" size="sm" onClick={cancelEdit} iconLeft={<X className="w-3.5 h-3.5" />}>キャンセル</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Badge tone={frame.is_active ? 'primary' : 'neutral'}>{frame.name}</Badge>
            <span className="text-sm text-stone-600 dark:text-stone-300">
              {formatTimeRange(frame.start_time, frame.end_time, { separator: ' - ' })}
            </span>
            <Badge tone="neutral">必要 {frame.required_count}人</Badge>
            {!frame.is_active && <Badge tone="warning">休止中</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => startEdit(frame)} iconLeft={<Pencil className="w-3.5 h-3.5" />}>編集</Button>
            <Button variant="secondary" size="sm" onClick={() => toggleActive(frame)} iconLeft={<Power className="w-3.5 h-3.5" />}>
              {frame.is_active ? '休止' : '有効化'}
            </Button>
            <Button variant="danger" size="sm" onClick={() => handleDelete(frame.id)} iconLeft={<Trash2 className="w-3.5 h-3.5" />}>削除</Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card padding="none">
        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800">
          <Heading level={2}>シフト枠（毎週テンプレ）</Heading>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-300">曜日ごとに必要な枠と必要人数を定義します。希望シフトの割当はシフト画面の「枠割当」から行います。</p>
        </div>

        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div className="w-full md:w-auto">
              <Select
                label="曜日"
                value={String(newDayOfWeek)}
                onChange={(e) => setNewDayOfWeek(Number(e.target.value))}
                options={FRAME_DAY_LABELS.map((d) => ({ value: String(d.value), label: d.label }))}
              />
            </div>
            <div className="w-full md:w-auto">
              {renderPresetSelect((name, start, end) => {
                setNewName(name);
                setNewStart(start);
                setNewEnd(end);
              })}
            </div>
            <div className="w-full md:flex-1 md:min-w-[120px]">
              <Input label="枠名" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: 早番" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:contents">
              <Select label="開始" value={newStart} onChange={(e) => setNewStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
              <Select label="終了" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
            </div>
            <div className="w-full md:w-auto">
              <Select label="必要人数" value={newRequired} onChange={(e) => setNewRequired(e.target.value)} options={REQUIRED_COUNT_OPTIONS} />
            </div>
            <Button variant="primary" size="md" onClick={handleAddWeekly} disabled={savingWeekly || !newName.trim()} loading={savingWeekly} className="w-full md:w-auto">
              追加
            </Button>
          </div>
        </div>

        {loading && frames.length === 0 ? (
          <PageSkeleton />
        ) : (
          <div>
            {FRAME_DAY_LABELS.map((d) => {
              const dayFrames = weeklyFramesByDay.get(d.value) ?? [];
              return (
                <div key={d.value} className="border-b border-stone-200 dark:border-stone-800 last:border-b-0">
                  <div className="px-6 pt-3 pb-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{d.label}曜日</div>
                  {dayFrames.length === 0 ? (
                    <div className="px-6 pb-3 text-sm text-stone-400 dark:text-stone-500">枠なし</div>
                  ) : (
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                      {dayFrames.map(renderFrameRow)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padding="none">
        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800">
          <Heading level={2}>単発枠（特定日のみ）</Heading>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-300">イベント日など、特定の1日だけ追加したい枠を登録します。</p>
        </div>

        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div className="w-full md:w-auto">
              <Input label="日付" type="date" value={oneOffDate} onChange={(e) => setOneOffDate(e.target.value)} min={todayStr} />
            </div>
            <div className="w-full md:w-auto">
              {renderPresetSelect((name, start, end) => {
                setOneOffName(name);
                setOneOffStart(start);
                setOneOffEnd(end);
              })}
            </div>
            <div className="w-full md:flex-1 md:min-w-[120px]">
              <Input label="枠名" type="text" value={oneOffName} onChange={(e) => setOneOffName(e.target.value)} placeholder="例: イベント特番" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:contents">
              <Select label="開始" value={oneOffStart} onChange={(e) => setOneOffStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
              <Select label="終了" value={oneOffEnd} onChange={(e) => setOneOffEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
            </div>
            <div className="w-full md:w-auto">
              <Select label="必要人数" value={oneOffRequired} onChange={(e) => setOneOffRequired(e.target.value)} options={REQUIRED_COUNT_OPTIONS} />
            </div>
            <Button variant="primary" size="md" onClick={handleAddOneOff} disabled={savingOneOff || !oneOffName.trim()} loading={savingOneOff} className="w-full md:w-auto">
              追加
            </Button>
          </div>
        </div>

        <div className="divide-y divide-stone-200 dark:divide-stone-800">
          {oneOffFrames.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="w-12 h-12 text-stone-400 dark:text-stone-500" />}
              title="単発枠が登録されていません"
              description="特定の日だけ必要な枠があれば上のフォームから追加してください"
            />
          ) : (
            oneOffFrames.map((frame) => (
              <div key={frame.id} className="px-6 py-3 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-800/50 motion-safe:transition-colors duration-150 ease-out">
                {editingId === frame.id ? (
                  <div className="flex flex-wrap items-end gap-3 flex-1">
                    <div className="w-full md:w-auto">
                      {renderPresetSelect((name, start, end) => {
                        setEditName(name);
                        setEditStart(start);
                        setEditEnd(end);
                      })}
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Input label="枠名" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <Select label="開始" value={editStart} onChange={(e) => setEditStart(e.target.value)} options={TIME_OPTION_OBJECTS} />
                    <Select label="終了" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} options={TIME_OPTION_OBJECTS} />
                    <Select label="必要人数" value={editRequired} onChange={(e) => setEditRequired(e.target.value)} options={REQUIRED_COUNT_OPTIONS} />
                    <Button variant="primary" size="sm" onClick={saveEdit} iconLeft={<Save className="w-3.5 h-3.5" />}>保存</Button>
                    <Button variant="secondary" size="sm" onClick={cancelEdit} iconLeft={<X className="w-3.5 h-3.5" />}>キャンセル</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <Badge tone="primary">{frame.date}</Badge>
                      <Badge tone={frame.is_active ? 'primary' : 'neutral'}>{frame.name}</Badge>
                      <span className="text-sm text-stone-600 dark:text-stone-300">
                        {formatTimeRange(frame.start_time, frame.end_time, { separator: ' - ' })}
                      </span>
                      <Badge tone="neutral">必要 {frame.required_count}人</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(frame)} iconLeft={<Pencil className="w-3.5 h-3.5" />}>編集</Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(frame.id)} iconLeft={<Trash2 className="w-3.5 h-3.5" />}>削除</Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
