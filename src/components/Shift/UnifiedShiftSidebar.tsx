import { useMemo, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { Card, Button } from '../ui';
import { PreferenceActionRow } from './PreferenceActionRow';
import { ShiftActionRow } from './ShiftActionRow';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';
import { PREFERENCE_THEME_LIST } from '../../lib/preferenceTheme';
import { formatTimeRange } from '../../utils/formatTimeRange';
import { buildTentativeShiftMap, getEffectiveTime } from '../../utils/preferenceEffectiveTime';
import type { Shift, ShiftPreference, ShiftPreset, Store, ShiftPreferenceType } from '../../types';

export type UnifiedShiftSidebarMode = 'manager' | 'staff';

export interface UnifiedShiftSidebarProps {
  mode: UnifiedShiftSidebarMode;
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;

  // データソース
  shifts: Shift[];
  preferences: ShiftPreference[];
  myPreferences: ShiftPreference[];
  memberNames: Map<string, string>;
  storeNames: Map<string, string>;

  // shift アクション (manager)
  onApproveShift?: (id: string) => Promise<void>;
  onRejectShift?: (id: string) => Promise<void>;
  onTentativeApproveShift?: (id: string) => Promise<void>;
  onCancelShiftTentative?: (id: string) => Promise<void>;
  onRevertShiftToTentative?: (id: string) => Promise<void>;
  onRestoreShift?: (id: string) => Promise<void>;
  onModifyShift?: (shift: Shift) => void;
  onDeleteShift?: (id: string) => Promise<void>;

  // preference アクション (manager)
  onApprovePreference?: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onRejectPreference?: (id: string) => Promise<void>;
  onRevertPreference?: (id: string) => Promise<void>;

  // staff アクション
  onSubmitPreference?: (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string,
  ) => Promise<void>;
  onDeletePreference?: (id: string) => Promise<void>;

  // 補助
  canManageStore: (storeId: string | null) => boolean;
  currentUserId: string | null;
  presets: ShiftPreset[];
  stores: Store[];
  defaultStoreId: string;
  onMutated: () => void;

  // サマリ (任意)
  adminSummary?: { counts: Record<ShiftPreferenceType, number>; monthLabel: string };
  preferenceSummary?: Record<ShiftPreferenceType, number>;
  pendingPreferenceCount?: number;

  // 締切ガード (staff モードのみ)
  isDeadlinePassed?: boolean;
  canBypassDeadline?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '申請中',
  tentative: '仮承認',
  approved: '本承認',
  modified: '修正',
  rejected: '却下',
  cancelled: '取消',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-orange-50 text-orange-700 dark:bg-orange-800/30 dark:text-orange-200',
  tentative: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-800/30 dark:text-emerald-200',
  modified: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-800/30 dark:text-red-200',
  cancelled: 'bg-stone-100 text-stone-700 dark:bg-stone-700/40 dark:text-stone-300',
};

const MEMBER_COLORS = [
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-member-3-100 border-member-3-300 text-member-3-800 dark:bg-member-3-100/20 dark:border-member-3-300/40 dark:text-member-3-100',
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-member-4-100 border-member-4-300 text-member-4-800 dark:bg-member-4-100/20 dark:border-member-4-300/40 dark:text-member-4-100',
  'bg-member-6-100 border-member-6-300 text-member-6-800 dark:bg-member-6-100/20 dark:border-member-6-300/40 dark:text-member-6-100',
  'bg-member-2-100 border-member-2-300 text-member-2-800 dark:bg-member-2-100/20 dark:border-member-2-300/40 dark:text-member-2-100',
  'bg-member-1-100 border-member-1-300 text-member-1-800 dark:bg-member-1-100/20 dark:border-member-1-300/40 dark:text-member-1-100',
  'bg-member-9-100 border-member-9-300 text-member-9-800 dark:bg-member-9-100/20 dark:border-member-9-300/40 dark:text-member-9-100',
  'bg-member-5-100 border-member-5-300 text-member-5-800 dark:bg-member-5-100/20 dark:border-member-5-300/40 dark:text-member-5-100',
  'bg-member-8-100 border-member-8-300 text-member-8-800 dark:bg-member-8-100/20 dark:border-member-8-300/40 dark:text-member-8-100',
];

function ShiftStatusReadonly({ shift }: { shift: Shift }) {
  return (
    <div className="text-xs text-stone-600 dark:text-stone-300 flex items-center gap-2 px-3 py-2 bg-stone-50 dark:bg-stone-800 rounded">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE_CLASS[shift.status] ?? 'bg-stone-100 text-stone-700'}`}>
        {STATUS_LABEL[shift.status] ?? shift.status}
      </span>
      <span className="tabular-nums">
        {format(new Date(shift.date + 'T00:00:00'), 'M月d日', { locale: ja })} {formatTimeRange(shift.start_time, shift.end_time)}
      </span>
    </div>
  );
}

export function UnifiedShiftSidebar({
  mode,
  selectedDate,
  onSelectedDateChange,

  shifts,
  preferences,
  myPreferences,
  memberNames,
  storeNames,

  onApproveShift,
  onRejectShift,
  onTentativeApproveShift,
  onCancelShiftTentative,
  onRevertShiftToTentative,
  onRestoreShift,
  onModifyShift,
  onDeleteShift,

  onApprovePreference,
  onRejectPreference,
  onRevertPreference,

  onSubmitPreference,
  onDeletePreference,

  canManageStore,
  currentUserId,
  presets,
  stores,
  defaultStoreId,
  onMutated,

  preferenceSummary,
  pendingPreferenceCount,

  isDeadlinePassed,
  canBypassDeadline,
}: UnifiedShiftSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null);

  const dateFilteredShifts = useMemo(() => {
    if (!selectedDate) return [];
    return shifts.filter(s => s.date === selectedDate);
  }, [shifts, selectedDate]);

  const dateFilteredPendingPreferences = useMemo(() => {
    if (!selectedDate) return [];
    return preferences.filter(p => p.date === selectedDate && p.status === 'pending');
  }, [preferences, selectedDate]);

  const tentativeShiftMap = useMemo(() => buildTentativeShiftMap(shifts ?? []), [shifts]);

  const existingPreference = useMemo(() => {
    if (!selectedDate) return undefined;
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

  // 理由: currentUserId=null のとき s.user_id === null が全件 false になり、自分の shift が「他メンバー」に紛れる事故を防ぐ defensive guard
  const myShifts = useMemo(() => {
    if (!currentUserId) return [];
    return dateFilteredShifts.filter(s => s.user_id === currentUserId);
  }, [dateFilteredShifts, currentUserId]);

  const otherShifts = useMemo(() => {
    if (!currentUserId) return dateFilteredShifts;
    return dateFilteredShifts.filter(s => s.user_id !== currentUserId);
  }, [dateFilteredShifts, currentUserId]);

  const otherPendingPreferences = useMemo(() => {
    if (!currentUserId) return dateFilteredPendingPreferences;
    return dateFilteredPendingPreferences.filter(p => p.user_id !== currentUserId);
  }, [dateFilteredPendingPreferences, currentUserId]);

  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const pendingPrefs = (preferences ?? []).filter(p => p.status === 'pending');
    const uniqueUsers = [...new Set([...shifts.map(s => s.user_id), ...pendingPrefs.map(p => p.user_id)])];
    uniqueUsers.forEach((uid, i) => {
      map.set(uid, MEMBER_COLORS[i % MEMBER_COLORS.length]);
    });
    return map;
  }, [shifts, preferences]);

  const handleFormSubmit = async (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeIdOverride?: string,
  ) => {
    if (!onSubmitPreference) return;
    await onSubmitPreference(date, type, startTime, endTime, note, storeIdOverride);
    onSelectedDateChange(null);
    onMutated();
  };

  const handleFormDelete = async (id: string) => {
    if (!onDeletePreference) return;
    await onDeletePreference(id);
    onSelectedDateChange(null);
    onMutated();
  };

  const handleFormCancel = () => {
    onSelectedDateChange(null);
  };

  // click outside listener (manager mode のみ)
  useEffect(() => {
    if (mode !== 'manager') return;
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

  if (mode === 'manager') {
    const canShowPreferenceList = !!onApprovePreference && !!onRejectPreference;

    const otherSectionShifts = otherShifts;
    const otherSectionPending = canShowPreferenceList ? otherPendingPreferences : [];
    const showOtherSection = otherSectionShifts.length > 0 || otherSectionPending.length > 0;

    return (
      <aside
        ref={sidebarRef}
        aria-label="統合シフトサイドバー"
        className="w-[360px] sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4"
      >
        {/* 選択日 Card (メイン) */}
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
              カレンダーで日付を選択すると、その日のシフト・申請が表示されます。
            </div>
          ) : (
            <>
              {/* 上段「あなたの申請」セクション */}
              <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-300 mb-1.5 px-1">
                あなたの申請
              </h4>
              {myShifts.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {myShifts.map(s => (
                    <li key={s.id}>
                      <ShiftStatusReadonly shift={s} />
                    </li>
                  ))}
                </ul>
              )}
              <ShiftPreferenceForm
                date={selectedDate}
                existingPreference={existingPreference}
                onSubmit={handleFormSubmit}
                onDelete={handleFormDelete}
                onCancel={handleFormCancel}
                presets={presets}
                selectableStores={stores}
                defaultStoreId={defaultStoreId}
                isDeadlinePassed={isDeadlinePassed}
                canBypassDeadline={canBypassDeadline}
              />

              {/* 理由: 「あなたの申請」と「他メンバー」セクションの divider */}
              {showOtherSection && (
                <div className="border-t border-stone-200 dark:border-stone-700 my-3" />
              )}

              {/* 下段「他メンバー」セクション */}
              {showOtherSection && (
                <>
                  <h4 className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1.5 px-1">
                    他メンバー
                  </h4>
                  {otherSectionShifts.length > 0 && (
                    <ul className="space-y-1">
                      {otherSectionShifts.map(s => (
                        <li key={s.id}>
                          <ShiftActionRow
                            shift={s}
                            memberName={memberNames.get(s.user_id)}
                            storeName={s.store_id ? storeNames.get(s.store_id) : undefined}
                            showStoreBadge={stores.length >= 2}
                            canManage={canManageStore(s.store_id)}
                            onApprove={onApproveShift}
                            onReject={onRejectShift}
                            onTentativeApprove={onTentativeApproveShift}
                            onCancelTentative={onCancelShiftTentative}
                            onRevertToTentative={onRevertShiftToTentative}
                            onRestore={onRestoreShift}
                            onModify={onModifyShift}
                            onDelete={onDeleteShift}
                            onMutated={onMutated}
                            userColor={userColorMap.get(s.user_id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {otherSectionPending.length > 0 && (
                    <ul className={`space-y-2 ${otherSectionShifts.length > 0 ? 'mt-3' : ''}`}>
                      {otherSectionPending.map(p => {
                        const eff = getEffectiveTime(p, tentativeShiftMap);
                        const showOverrideRow =
                          eff.isOverridden && !!p.start_time && !!p.end_time && !!eff.start && !!eff.end;
                        return (
                          <li key={p.id} className="space-y-1">
                            <PreferenceActionRow
                              preference={p}
                              memberName={memberNames.get(p.user_id)}
                              onApprove={onApprovePreference!}
                              onReject={onRejectPreference!}
                              onRevert={onRevertPreference}
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
                </>
              )}
            </>
          )}
        </Card>

        {/* 未対応サマリ Card */}
        <Card padding="sm">
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-600">
              {pendingPreferenceCount ?? 0}
            </div>
            <div className="text-sm text-stone-500 mt-1">
              未対応のシフト申請
            </div>
          </div>
        </Card>

        {/* preferenceSummary Card (新規・staff と同じ仕様。manager にも表示) */}
        {preferenceSummary && (
          <Card padding="sm">
            <Card.Header>サマリ</Card.Header>
            <div className="grid grid-cols-3 gap-2 text-center">
              {PREFERENCE_THEME_LIST.map(t => (
                <div key={t.type} className="space-y-1">
                  <div className={`text-3xl font-bold tabular-nums ${t.countTextClass}`}>
                    {preferenceSummary[t.type] ?? 0}
                  </div>
                  <div className="text-xs text-stone-500">{t.label}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </aside>
    );
  }

  // mode === 'staff'
  return (
    <aside
      ref={sidebarRef}
      aria-label="統合シフトサイドバー"
      className="w-[360px] sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4"
    >
      {/* ShiftStatusReadonly: 自分の確定シフト read-only */}
      {selectedDate && dateFilteredShifts.length > 0 && (
        <Card padding="sm">
          <Card.Header>この日の自分のシフト</Card.Header>
          <div className="space-y-1">
            {dateFilteredShifts.map(s => (
              <ShiftStatusReadonly key={s.id} shift={s} />
            ))}
          </div>
        </Card>
      )}

      {/* ShiftPreferenceForm Card */}
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
            isDeadlinePassed={isDeadlinePassed}
            canBypassDeadline={canBypassDeadline}
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

      {/* サマリ Card */}
      {preferenceSummary && (
        <Card padding="sm">
          <Card.Header>サマリ</Card.Header>
          <div className="grid grid-cols-3 gap-2 text-center">
            {PREFERENCE_THEME_LIST.map(t => (
              <div key={t.type} className="space-y-1">
                <div className={`text-3xl font-bold tabular-nums ${t.countTextClass}`}>
                  {preferenceSummary[t.type] ?? 0}
                </div>
                <div className="text-xs text-stone-500">{t.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </aside>
  );
}
