import { useState, useMemo } from 'react';
import { eachDayOfInterval, parseISO, format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Button, Select, Input, Checkbox, BottomSheet } from '../ui';
import type { ShiftPreset, TenantMember } from '../../types';

const DAY_LABELS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

const CHUNK_SIZE = 100;

export function BulkApplyPresetModal({
  isOpen,
  onClose,
  tenantId,
  storeId,
  presets,
  members,
  onApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  storeId: string;
  presets: ShiftPreset[];
  members: TenantMember[];
  onApplied: (insertedCount: number, skippedCount: number) => void;
}) {
  const { showToast } = useToast();
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedDays, setSelectedDays] = useState<Set<number>>(
    () => new Set(DAY_LABELS.map((d) => d.value))
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const presetOptions = useMemo(
    () =>
      presets.map((p) => ({
        value: String(p.id),
        label: `${p.name} (${p.start_time.slice(0, 5)}-${p.end_time.slice(0, 5)})`,
      })),
    [presets]
  );

  const selectedPreset = useMemo(
    () => presets.find((p) => String(p.id) === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );

  const isValid =
    selectedPreset !== null &&
    startDate !== '' &&
    endDate !== '' &&
    selectedDays.size > 0 &&
    selectedMemberIds.size > 0;

  const toggleDay = (day: number) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const selectAllMembers = () => {
    setSelectedMemberIds(new Set(members.map((m) => m.user_id)));
  };

  const clearAllMembers = () => {
    setSelectedMemberIds(new Set());
  };

  const handleSubmit = async () => {
    if (!selectedPreset || !startDate || !endDate) return;

    setSubmitting(true);

    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);

      const allDays = eachDayOfInterval({ start, end });
      const targetDates = allDays.filter((d) => selectedDays.has(d.getDay()));

      if (targetDates.length === 0) {
        showToast('対象日の曜日が選択されていません', 'error');
        setSubmitting(false);
        return;
      }

      const memberArray = Array.from(selectedMemberIds);

      // Fetch existing shift_preferences for the target dates
      const { data: existingPrefs, error: fetchError } = await supabase
        .from('shift_preferences')
        .select('user_id, date')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('date', format(start, 'yyyy-MM-dd'))
        .lte('date', format(end, 'yyyy-MM-dd'))
        .in('user_id', memberArray);

      if (fetchError) {
        showToast('既存データの取得に失敗しました', 'error');
        setSubmitting(false);
        return;
      }

      const existingSet = new Set<string>();
      if (existingPrefs) {
        for (const pref of existingPrefs) {
          existingSet.add(`${pref.user_id}:${pref.date}`);
        }
      }

      const rowsToInsert: {
        tenant_id: string;
        store_id: string;
        user_id: string;
        date: string;
        preference_type: string;
        start_time: string;
        end_time: string;
      }[] = [];

      let skippedCount = 0;

      for (const date of targetDates) {
        const dateStr = format(date, 'yyyy-MM-dd');
        for (const userId of memberArray) {
          const key = `${userId}:${dateStr}`;
          if (existingSet.has(key)) {
            skippedCount++;
          } else {
            rowsToInsert.push({
              tenant_id: tenantId,
              store_id: storeId,
              user_id: userId,
              date: dateStr,
              preference_type: 'preferred',
              start_time: selectedPreset.start_time,
              end_time: selectedPreset.end_time,
            });
          }
        }
      }

      // Batch insert in chunks
      let insertedCount = 0;
      for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
        const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
        const { error: insertError } = await supabase
          .from('shift_preferences')
          .insert(chunk);

        if (insertError) {
          showToast(`挿入エラー: ${insertError.message}`, 'error');
          setSubmitting(false);
          return;
        }
        insertedCount += chunk.length;
      }

      onApplied(insertedCount, skippedCount);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました';
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ margin: 0 }}>プリセット一括適用</h2>

        <div>
          <label style={{ display: 'block', marginBottom: '4px' }}>プリセット</label>
          <Select
            value={selectedPresetId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPresetId(e.target.value)}
            options={[{ value: '', label: '-- 選択してください --' }, ...presetOptions]}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>開始日</label>
            <Input type="date" value={startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>終了日</label>
            <Input type="date" value={endDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px' }}>対象曜日</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DAY_LABELS.map((day) => (
              <Checkbox
                key={day.value}
                label={day.label}
                checked={selectedDays.has(day.value)}
                onChange={() => toggleDay(day.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label>対象メンバー</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button size="sm" variant="secondary" onClick={selectAllMembers}>全選択</Button>
              <Button size="sm" variant="secondary" onClick={clearAllMembers}>全解除</Button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
            {members.map((member) => (
              <Checkbox
                key={member.user_id}
                label={member.display_name}
                checked={selectedMemberIds.has(member.user_id)}
                onChange={() => toggleMember(member.user_id)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '8px' }}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting ? '適用中...' : '一括適用'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
