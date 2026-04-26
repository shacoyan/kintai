import { useMemo } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, CheckCircle2, Circle, XCircle, ChevronRight } from 'lucide-react';
import { Card, Button } from '../ui';
import { PreferenceActionRow } from './PreferenceActionRow';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';

import type { ShiftPreference, ShiftPreset, Store, ShiftPreferenceType } from '../../types';

export interface ShiftPreferenceSidebarProps {
  mode: 'self' | 'admin';
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
  preferences: ShiftPreference[];
  myPreferences: ShiftPreference[];
  memberNames: Map<string, string>;
  pendingPreferenceCount: number;
  preferenceSummary: { preferredCount: number; availableCount: number; unavailableCount: number };
  timedPreferences: ShiftPreference[];
  onApprovePreference: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onRejectPreference: (id: string) => Promise<void>;
  canManageStore: (storeId: string | null) => boolean;
  onSubmitPreference: (date: string, type: ShiftPreferenceType, startTime?: string, endTime?: string, note?: string, storeIdOverride?: string) => Promise<void>;
  onDeletePreference: (id: string) => Promise<void>;
  presets: ShiftPreset[];
  stores: Store[];
  defaultStoreId: string;
  onMutated: () => void;
}

export function ShiftPreferenceSidebar(props: ShiftPreferenceSidebarProps) {
  const {
    mode,
    selectedDate,
    onSelectedDateChange,
    preferences,
    myPreferences,
    memberNames,
    pendingPreferenceCount,
    preferenceSummary,
    timedPreferences,
    onApprovePreference,
    onRejectPreference,
    canManageStore,
    onSubmitPreference,
    onDeletePreference,
    presets,
    stores,
    defaultStoreId,
    onMutated,
  } = props;

  const dateFilteredPreferences = useMemo(() => {
    if (!selectedDate) return [];
    return preferences.filter(p => p.date === selectedDate);
  }, [preferences, selectedDate]);

  const existingPreference = useMemo(() => {
    if (!selectedDate) return undefined;
    return myPreferences.find(p => p.date === selectedDate);
  }, [myPreferences, selectedDate]);

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDate) return '日付を選択';
    try {
      return format(new Date(selectedDate + 'T00:00:00'), 'M月d日(E)', { locale: ja });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const handleFormSubmit = async (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string
  ) => {
    await onSubmitPreference(date, type, startTime, endTime, note, storeIdOverride);
    onSelectedDateChange(null);
    onMutated();
  };

  const handleFormDelete = async (id: string) => {
    await onDeletePreference(id);
    onSelectedDateChange(null);
    onMutated();
  };

  const handleFormCancel = () => {
    onSelectedDateChange(null);
  };

  const handleTimedPreferenceClick = (date: string) => {
    onSelectedDateChange(date);
  };

  return (
    <aside className="w-[360px] sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4">
      {mode === 'admin' && (
        <>
          <Card padding="sm">
            <Card.Header>凡例</Card.Header>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-warning-500 shrink-0" />
                <CheckCircle2 className="w-4 h-4 text-warning-500 shrink-0" />
                <span>希望</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary-500 shrink-0" />
                <Circle className="w-4 h-4 text-primary-500 shrink-0" />
                <span>出勤可</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-400 shrink-0" />
                <XCircle className="w-4 h-4 text-neutral-400 shrink-0" />
                <span>不可</span>
              </div>
            </div>
          </Card>

          <Card padding="sm">
            <Card.Header className="flex justify-between items-center">
              <span>{formattedSelectedDate}</span>
              {selectedDate && (
                <Button variant="tertiary" size="sm" onClick={() => onSelectedDateChange(null)}>
                  クリア
                </Button>
              )}
            </Card.Header>
            {!selectedDate ? (
              <div className="text-sm text-neutral-500">
                カレンダーで日付を選択すると、その日のシフト希望一覧が表示されます。
              </div>
            ) : dateFilteredPreferences.length === 0 ? (
              <div className="text-sm text-neutral-500">
                この日の希望はありません
              </div>
            ) : (
              <ul className="space-y-2">
                {dateFilteredPreferences.map(p => (
                  <li key={p.id}>
                    <PreferenceActionRow
                      preference={p}
                      memberName={memberNames.get(p.user_id)}
                      onApprove={onApprovePreference}
                      onReject={onRejectPreference}
                      canManage={canManageStore(p.store_id)}
                      variant="full"
                      onMutated={onMutated}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="sm">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary-600">
                {pendingPreferenceCount}
              </div>
              <div className="text-sm text-neutral-500 mt-1">
                未対応の希望
              </div>
            </div>
          </Card>
        </>
      )}

      {mode === 'self' && (
        <>
          <Card padding="sm">
            {selectedDate ? (
              <ShiftPreferenceForm
                date={selectedDate}
                existingPreference={existingPreference}
                onSubmit={handleFormSubmit}
                onDelete={handleFormDelete}
                onCancel={handleFormCancel}
                presets={presets}
                selectableStores={stores}
                defaultStoreId={defaultStoreId}
              />
            ) : (
              <Button
                variant="primary"
                fullWidth
                iconLeft={<Plus className="w-4 h-4" />}
                onClick={() => onSelectedDateChange(format(new Date(), 'yyyy-MM-dd'))}
              >
                本日の希望を追加・編集
              </Button>
            )}
          </Card>

          <Card padding="sm">
            <Card.Header>サマリ</Card.Header>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="space-y-1">
                <div className="text-3xl font-bold text-warning-500">
                  {preferenceSummary.preferredCount}
                </div>
                <div className="text-xs text-neutral-500">希望</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl font-bold text-primary-500">
                  {preferenceSummary.availableCount}
                </div>
                <div className="text-xs text-neutral-500">出勤可</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl font-bold text-neutral-400">
                  {preferenceSummary.unavailableCount}
                </div>
                <div className="text-xs text-neutral-500">不可</div>
              </div>
            </div>
          </Card>

          {timedPreferences.length > 0 && (
            <Card padding="none">
              <ul>
                {timedPreferences.map(p => {
                  const timeLabel = p.start_time && p.end_time 
                    ? `${p.start_time}-${p.end_time}` 
                    : '時間未定';
                  const dateLabel = format(new Date(p.date + 'T00:00:00'), 'MM-dd');
                  
                  return (
                    <li key={p.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
                        onClick={() => handleTimedPreferenceClick(p.date)}
                      >
                        <span className="text-sm font-medium">
                          {dateLabel} {timeLabel}
                        </span>
                        <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </aside>
  );
}
