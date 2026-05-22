import { useMemo, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ChevronRight } from 'lucide-react';
import { Card, Button, EmptyState } from '../ui';
import { PreferenceActionRow } from './PreferenceActionRow';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';
import { PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';

import type { Shift, ShiftPreference, ShiftPreset, Store, ShiftPreferenceType } from '../../types';
import { messages } from '../../lib/messages';
import { formatTimeRange } from '../../utils/formatTimeRange';
import { buildTentativeShiftMap, getEffectiveTime } from '../../utils/preferenceEffectiveTime';

export interface ShiftPreferenceSidebarProps {
  mode: 'self' | 'admin';
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
  preferences: ShiftPreference[];
  myPreferences: ShiftPreference[];
  memberNames: Map<string, string>;
  pendingPreferenceCount: number;
  preferenceSummary: Record<ShiftPreferenceType, number>;
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
  adminSummary?: {
    counts: Record<ShiftPreferenceType, number>;
    monthLabel: string;
  };
  onRevertPreference?: (id: string) => Promise<void>;
  /** 仮承認後の時間を併記表示するためのシフト一覧 (admin モードでのみ使用) */
  shifts?: Shift[];
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
    adminSummary,
    shifts,
  } = props;

  const dateFilteredPreferences = useMemo(() => {
    if (!selectedDate) return [];
    return preferences.filter(p => p.date === selectedDate);
  }, [preferences, selectedDate]);

  const tentativeShiftMap = useMemo(
    () => buildTentativeShiftMap(shifts ?? []),
    [shifts]
  );

  const existingPreference = useMemo(() => {
    if (!selectedDate) return undefined;
    // B-1 修正: 同日に複数店舗の自分行が存在する場合 currentStore (defaultStoreId) を優先
    return (
      myPreferences.find(p => p.date === selectedDate && p.store_id === defaultStoreId)
      ?? myPreferences.find(p => p.date === selectedDate)
    );
  }, [myPreferences, selectedDate, defaultStoreId]);

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

  // Loop7 / 要望 X: 全員モードのみ Sidebar 外クリックで選択解除する。
  // - self モードでは ShiftPreferenceForm の入力中に誤発火する恐れがあるため発火させない。
  // - Modal / Portal (例: BulkApplyPresetModal, BulkShiftPreferenceDialog, Toast 内の dialog) を
  //   `[role="dialog"]` 祖先判定で除外し、その内側クリックで Sidebar の選択が消えないようにする。
  // - mousedown ではなく click を採用: dropdown 等の onClick より早く発火させないため。
  // - P0 修正 (Reviewer 指摘): カレンダーグリッド (`[role="grid"]`) も除外する。
  //   bubble phase でこの listener が走るため、セル onClick → setAllMemberPrefDate(newDate) の直後に
  //   document click listener が同 event で発火し、target がグリッド内 (Sidebar 外) → null 上書きで
  //   即解除されるバグがあった。React 18 自動 batching で setState(newDate) → setState(null) の順となり
  //   null が勝つため、日付切替自体が破壊される。グリッド内クリックを早期 return で除外して根治。
  // - P3 修正: ActionMenu (`[role="menu"]`) / Toast (`[role="status"]`) / alertdialog も除外漏れだった。
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mode !== 'admin') return;
    if (!selectedDate) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (sidebarRef.current?.contains(target)) return;
      // Sidebar 内 / Modal 内 / カレンダーグリッド内 / ActionMenu 内 / Toast 内 は除外
      if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="status"], [role="grid"]')) return;
      onSelectedDateChange(null);
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [mode, selectedDate, onSelectedDateChange]);

  return (
    <aside ref={sidebarRef} aria-label="シフト申請サイドバー" className="w-[360px] sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4">
      {mode === 'admin' && (
        <>
          <Card padding="sm">
            <Card.Header>凡例</Card.Header>
            <div className="flex flex-col gap-2 text-sm">
              {PREFERENCE_THEME_LIST.map(t => (
                <div key={t.type} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.dotClass}`} />
                  <t.Icon className={`w-4 h-4 shrink-0 ${t.iconColorClass}`} aria-hidden="true" />
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {adminSummary && (
            <Card padding="sm">
              <Card.Header>{adminSummary.monthLabel}のシフト申請</Card.Header>
              <div className="grid grid-cols-3 gap-2 text-center">
                {PREFERENCE_THEME_LIST.map(t => (
                  <div key={t.type}>
                    <div className={`text-2xl font-bold tabular-nums ${t.countTextClass}`}>{adminSummary.counts[t.type]}</div>
                    <div className="text-xs text-stone-500">{t.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

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
              <div className="text-sm text-stone-500">
                カレンダーで日付を選択すると、その日のシフト申請一覧が表示されます。
              </div>
            ) : dateFilteredPreferences.length === 0 ? (
              <EmptyState
                size="sm"
                title={messages.empty.shiftPreferenceDay.title}
              />
            ) : (
              <ul className="space-y-2">
                {dateFilteredPreferences.map(p => {
                  const eff = getEffectiveTime(p, tentativeShiftMap);
                  const showOverrideRow =
                    eff.isOverridden && !!p.start_time && !!p.end_time && !!eff.start && !!eff.end;
                  return (
                    <li key={p.id} className="space-y-1">
                      <PreferenceActionRow
                        preference={p}
                        memberName={memberNames.get(p.user_id)}
                        onApprove={onApprovePreference}
                        onReject={onRejectPreference}
                        canManage={canManageStore(p.store_id)}
                        variant="full"
                        onMutated={onMutated}
                      />
                      {showOverrideRow && (
                        <div className="text-[11px] text-stone-500 dark:text-stone-300 px-2 leading-relaxed">
                          <div>
                            申請:{' '}
                            <span className="tabular-nums">
                              {formatTimeRange(p.start_time!, p.end_time!, { separator: ' 〜 ' })}
                            </span>
                          </div>
                          <div>
                            承認:{' '}
                            <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-200">
                              {formatTimeRange(eff.start!, eff.end!, { separator: ' 〜 ' })}
                            </span>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card padding="sm">
            <div className="text-center">
              <div className="text-4xl font-bold text-blue-600">
                {pendingPreferenceCount}
              </div>
              <div className="text-sm text-stone-500 mt-1">
                未対応のシフト申請
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
                本日のシフト申請を追加・編集
              </Button>
            )}
          </Card>

          <Card padding="sm">
            <Card.Header>サマリ</Card.Header>
            <div className="grid grid-cols-3 gap-2 text-center">
              {PREFERENCE_THEME_LIST.map(t => (
                <div key={t.type} className="space-y-1">
                  <div className={`text-3xl font-bold tabular-nums ${t.countTextClass}`}>
                    {preferenceSummary[t.type]}
                  </div>
                  <div className="text-xs text-stone-500">{t.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {timedPreferences.length > 0 && (
            <Card padding="none">
              <ul>
                {timedPreferences.map(p => {
                  const timeLabel = p.start_time && p.end_time
                    ? formatTimeRange(p.start_time, p.end_time)
                    : '時間未定';
                  const dateLabel = format(new Date(p.date + 'T00:00:00'), 'MM-dd');
                  
                  return (
                    <li key={p.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone-50 dark:hover:bg-stone-800 motion-safe:transition-colors duration-150 ease-out"
                        onClick={() => handleTimedPreferenceClick(p.date)}
                      >
                        <span className="text-sm font-medium">
                          {dateLabel} {timeLabel}
                        </span>
                        <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
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
