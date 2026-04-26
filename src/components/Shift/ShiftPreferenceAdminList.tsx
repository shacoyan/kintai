import { useState } from 'react';
import { CheckCircle2, XCircle, Circle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShiftPreference } from '../../types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface ShiftPreferenceAdminListProps {
  preferences: ShiftPreference[];
  memberNames: Map<string, string>;
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRefresh: () => void;
  historyMode?: boolean;
  canManageStore: (storeId: string | null) => boolean;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const PREFERENCE_ICON: Record<string, LucideIcon> = {
  preferred: CheckCircle2,
  available: Circle,
  unavailable: XCircle,
};

const PREFERENCE_LABEL: Record<string, string> = {
  preferred: '希望',
  available: '出勤可能',
  unavailable: '出勤不可',
};

interface CardState {
  loading: boolean;
  error: string | null;
  showTimeEditor: boolean;
  editStart: string;
  editEnd: string;
}

export function ShiftPreferenceAdminList({
  preferences,
  memberNames,
  onApprove,
  onReject,
  onRefresh,
  historyMode = false,
  canManageStore,
}: ShiftPreferenceAdminListProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [cardStates, setCardStates] = useState<Map<string, CardState>>(new Map());

  const displayed = historyMode ? preferences : (statusFilter === 'all' ? preferences : preferences.filter((p) => p.status === 'pending'));

  function getState(id: string, pref: ShiftPreference): CardState {
    return cardStates.get(id) ?? {
      loading: false,
      error: null,
      showTimeEditor: false,
      editStart: pref.start_time?.slice(0, 5) ?? '09:00',
      editEnd: pref.end_time?.slice(0, 5) ?? '18:00',
    };
  }

  function setState(id: string, patch: Partial<CardState>) {
    setCardStates((prev) => {
      const next = new Map(prev);
      const current = prev.get(id) ?? {
        loading: false,
        error: null,
        showTimeEditor: false,
        editStart: '09:00',
        editEnd: '18:00',
      };
      next.set(id, { ...current, ...patch });
      return next;
    });
  }

  async function handleApprove(pref: ShiftPreference, withTime?: boolean) {
    const state = getState(pref.id, pref);
    setState(pref.id, { loading: true, error: null });
    try {
      if (withTime) {
        await onApprove(pref.id, state.editStart, state.editEnd);
      } else {
        await onApprove(pref.id);
      }
      onRefresh();
    } catch (err) {
      setState(pref.id, {
        loading: false,
        error: err instanceof Error ? err.message : '操作に失敗しました',
      });
      return;
    }
    setState(pref.id, { loading: false, showTimeEditor: false });
  }

  async function handleReject(pref: ShiftPreference) {
    setState(pref.id, { loading: true, error: null });
    try {
      await onReject(pref.id);
      onRefresh();
    } catch (err) {
      setState(pref.id, {
        loading: false,
        error: err instanceof Error ? err.message : '操作に失敗しました',
      });
      return;
    }
    setState(pref.id, { loading: false });
  }

  const pendingCount = preferences.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          {historyMode ? 'シフト希望の履歴' : 'シフト希望の承認'}
          {historyMode ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
              全 {preferences.length} 件
            </span>
          ) : (
            pendingCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200">
                {pendingCount}件 未対応
              </span>
            )
          )}
        </h3>
      </div>

      {/* フィルタータブ */}
      {!historyMode && (
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
          <button
            onClick={() => setStatusFilter('pending')}
            aria-pressed={statusFilter === 'pending'}
            className={`px-3 py-1.5 text-xs transition-colors ${
              statusFilter === 'pending'
                ? 'border-b-2 border-primary-600 text-primary-600 font-semibold dark:border-primary-400 dark:text-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            申請中({pendingCount})
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            aria-pressed={statusFilter === 'all'}
            className={`px-3 py-1.5 text-xs transition-colors ${
              statusFilter === 'all'
                ? 'border-b-2 border-primary-600 text-primary-600 font-semibold dark:border-primary-400 dark:text-primary-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            すべて
          </button>
        </div>
      )}

      {displayed.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">
          {historyMode ? '履歴はありません' : (statusFilter === 'all' ? '希望がありません' : '未対応の希望はありません')}
        </p>
      )}

      <div className="space-y-2">
        {displayed.map((pref) => {
          const state = getState(pref.id, pref);
          const memberName = memberNames.get(pref.user_id) ?? '不明';
          const Ic = PREFERENCE_ICON[pref.preference_type] ?? Circle;
          const label = PREFERENCE_LABEL[pref.preference_type] ?? '';
          const timeLabel =
            pref.preference_type !== 'unavailable' && pref.start_time && pref.end_time
              ? `${pref.start_time.slice(0, 5)} 〜 ${pref.end_time.slice(0, 5)}`
              : null;

          const isPending = pref.status === 'pending';
          const isApproved = pref.status === 'approved';
          const isRejected = pref.status === 'rejected';
          const canManageRow = canManageStore(pref.store_id);

          return (
            <div
              key={pref.id}
              className={`rounded-lg border p-3 space-y-2 transition ${
                isPending
                  ? 'border-warning-200 bg-warning-50 dark:border-warning-700 dark:bg-warning-950'
                  : isApproved
                  ? 'border-success-200 bg-success-50 dark:border-success-700 dark:bg-success-950'
                  : 'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800'
              }`}
            >
              {/* 上段: 名前・日付・タイプ・ステータス */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {memberName}
                    </span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{pref.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-base leading-none font-bold ${
                        pref.preference_type === 'preferred'
                          ? 'text-primary-600 dark:text-primary-400'
                          : pref.preference_type === 'available'
                          ? 'text-success-600 dark:text-success-400'
                          : 'text-danger-600 dark:text-danger-400'
                      }`}
                    >
                      <Ic className="w-4 h-4" />
                    </span>
                    <span className="text-xs text-neutral-600 dark:text-neutral-300">{label}</span>
                    {timeLabel && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{timeLabel}</span>
                    )}
                  </div>
                  {pref.note && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{pref.note}</p>
                  )}
                </div>

                {/* ステータスバッジ */}
                <div className="flex-shrink-0">
                  {isApproved && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-800 dark:text-success-200">
                      <CheckCircle2 className="w-3 h-3" />承認済
                    </span>
                  )}
                  {isRejected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      <XCircle className="w-3 h-3" />却下済
                    </span>
                  )}
                  {isPending && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-800 dark:text-warning-200">
                      未対応
                    </span>
                  )}
                </div>
              </div>

              {/* エラー表示 */}
              {!historyMode && state.error && (
                <p className="text-xs text-danger-600 dark:text-danger-400">{state.error}</p>
              )}

              {/* アクション領域 / unavailable バッジ */}
              {!historyMode && isPending && pref.preference_type === 'unavailable' && (
                <Badge tone="neutral">出勤不可（承認不要）</Badge>
              )}

              {/* 時間指定エディタ */}
              {!historyMode && state.showTimeEditor && isPending && canManageRow && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">
                      開始時刻
                    </label>
                    <select
                      value={state.editStart}
                      onChange={(e) => setState(pref.id, { editStart: e.target.value })}
                      className="block w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 dark:text-neutral-100"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">
                      終了時刻
                    </label>
                    <select
                      value={state.editEnd}
                      onChange={(e) => setState(pref.id, { editEnd: e.target.value })}
                      className="block w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-neutral-700 dark:text-neutral-100"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* 権限なし表示 */}
              {!historyMode && isPending && !canManageRow && pref.preference_type !== 'unavailable' && (
                <div className="pt-1">
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">権限なし</span>
                </div>
              )}

              {/* アクションボタン (pending のみ・操作権限あり・出勤不可以外) */}
              {!historyMode && isPending && canManageRow && pref.preference_type !== 'unavailable' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {/* 承認ボタン */}
                  {!state.showTimeEditor && (
                    <Button
                      type="button"
                      disabled={state.loading}
                      onClick={() => handleApprove(pref)}
                      variant="primary"
                      className="h-auto px-3 py-1 text-xs bg-success-600 hover:bg-success-700 dark:bg-success-700 dark:hover:bg-success-600"
                    >
                      {state.loading ? '処理中...' : '承認'}
                    </Button>
                  )}

                  {/* 時間指定承認 */}
                  {!state.showTimeEditor && (
                    <Button
                      type="button"
                      disabled={state.loading}
                      onClick={() => setState(pref.id, { showTimeEditor: true })}
                      variant="tertiary"
                      className="h-auto px-3 py-1 text-xs text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 dark:text-primary-300 dark:bg-primary-900 dark:border-primary-700 dark:hover:bg-primary-800"
                    >
                      時間指定承認
                    </Button>
                  )}

                  {/* 時間指定エディタが開いている時の確定・キャンセル */}
                  {state.showTimeEditor && (
                    <>
                      <Button
                        type="button"
                        disabled={state.loading}
                        onClick={() => handleApprove(pref, true)}
                        variant="primary"
                        className="h-auto px-3 py-1 text-xs bg-success-600 hover:bg-success-700 dark:bg-success-700 dark:hover:bg-success-600"
                      >
                        {state.loading ? '処理中...' : '時間指定で承認'}
                      </Button>
                      <Button
                        type="button"
                        disabled={state.loading}
                        onClick={() => setState(pref.id, { showTimeEditor: false })}
                        variant="tertiary"
                        className="h-auto px-3 py-1 text-xs text-neutral-600 bg-neutral-100 hover:bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                      >
                        キャンセル
                      </Button>
                    </>
                  )}

                  {/* 却下ボタン */}
                  {!state.showTimeEditor && (
                    <Button
                      type="button"
                      disabled={state.loading}
                      onClick={() => handleReject(pref)}
                      variant="danger"
                      className="h-auto px-3 py-1 text-xs text-danger-700 bg-danger-50 border border-danger-200 hover:bg-danger-100 dark:text-danger-300 dark:bg-danger-900 dark:border-danger-700 dark:hover:bg-danger-800"
                    >
                      {state.loading ? '処理中...' : '却下'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
