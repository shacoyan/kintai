import { useState } from 'react';
import type { ShiftPreference } from '../../types';

interface ShiftPreferenceAdminListProps {
  preferences: ShiftPreference[];
  memberNames: Map<string, string>;
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRefresh: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

const PREFERENCE_ICON: Record<string, string> = {
  preferred: '◎',
  available: '○',
  unavailable: '✕',
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
}: ShiftPreferenceAdminListProps) {
  const [showAll, setShowAll] = useState(false);
  const [cardStates, setCardStates] = useState<Map<string, CardState>>(new Map());

  const displayed = showAll ? preferences : preferences.filter((p) => p.status === 'pending');

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
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          シフト希望の承認
          {pendingCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              {pendingCount}件 未対応
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showAll ? '未対応のみ表示' : '全て表示'}
        </button>
      </div>

      {displayed.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
          {showAll ? '希望がありません' : '未対応の希望はありません'}
        </p>
      )}

      <div className="space-y-2">
        {displayed.map((pref) => {
          const state = getState(pref.id, pref);
          const memberName = memberNames.get(pref.user_id) ?? '不明';
          const icon = PREFERENCE_ICON[pref.preference_type] ?? '?';
          const label = PREFERENCE_LABEL[pref.preference_type] ?? '';
          const timeLabel =
            pref.preference_type !== 'unavailable' && pref.start_time && pref.end_time
              ? `${pref.start_time.slice(0, 5)} 〜 ${pref.end_time.slice(0, 5)}`
              : null;

          const isPending = pref.status === 'pending';
          const isApproved = pref.status === 'approved';
          const isRejected = pref.status === 'rejected';

          return (
            <div
              key={pref.id}
              className={`rounded-lg border p-3 space-y-2 transition ${
                isPending
                  ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950'
                  : isApproved
                  ? 'border-green-200 bg-green-50 dark:border-green-700 dark:bg-green-950'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
              }`}
            >
              {/* 上段: 名前・日付・タイプ・ステータス */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {memberName}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{pref.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-base leading-none font-bold ${
                        pref.preference_type === 'preferred'
                          ? 'text-blue-600 dark:text-blue-400'
                          : pref.preference_type === 'available'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {icon}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
                    {timeLabel && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{timeLabel}</span>
                    )}
                  </div>
                  {pref.note && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{pref.note}</p>
                  )}
                </div>

                {/* ステータスバッジ */}
                <div className="flex-shrink-0">
                  {isApproved && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200">
                      ✅ 承認済
                    </span>
                  )}
                  {isRejected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      ❌ 却下済
                    </span>
                  )}
                  {isPending && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-800 dark:text-yellow-200">
                      未対応
                    </span>
                  )}
                </div>
              </div>

              {/* エラー表示 */}
              {state.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
              )}

              {/* 時間指定エディタ */}
              {state.showTimeEditor && isPending && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      開始時刻
                    </label>
                    <select
                      value={state.editStart}
                      onChange={(e) => setState(pref.id, { editStart: e.target.value })}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      終了時刻
                    </label>
                    <select
                      value={state.editEnd}
                      onChange={(e) => setState(pref.id, { editEnd: e.target.value })}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100"
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

              {/* アクションボタン (pending のみ) */}
              {isPending && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {/* 承認ボタン (出勤不可以外) */}
                  {pref.preference_type !== 'unavailable' && !state.showTimeEditor && (
                    <button
                      type="button"
                      disabled={state.loading}
                      onClick={() => handleApprove(pref)}
                      className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition dark:bg-green-700 dark:hover:bg-green-600"
                    >
                      {state.loading ? '処理中...' : '承認'}
                    </button>
                  )}

                  {/* 時間指定承認 */}
                  {pref.preference_type !== 'unavailable' && !state.showTimeEditor && (
                    <button
                      type="button"
                      disabled={state.loading}
                      onClick={() => setState(pref.id, { showTimeEditor: true })}
                      className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition dark:text-blue-300 dark:bg-blue-900 dark:border-blue-700 dark:hover:bg-blue-800"
                    >
                      時間指定承認
                    </button>
                  )}

                  {/* 時間指定エディタが開いている時の確定・キャンセル */}
                  {state.showTimeEditor && (
                    <>
                      <button
                        type="button"
                        disabled={state.loading}
                        onClick={() => handleApprove(pref, true)}
                        className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition dark:bg-green-700 dark:hover:bg-green-600"
                      >
                        {state.loading ? '処理中...' : '時間指定で承認'}
                      </button>
                      <button
                        type="button"
                        disabled={state.loading}
                        onClick={() => setState(pref.id, { showTimeEditor: false })}
                        className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 transition dark:text-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                      >
                        キャンセル
                      </button>
                    </>
                  )}

                  {/* 却下ボタン */}
                  {!state.showTimeEditor && (
                    <button
                      type="button"
                      disabled={state.loading}
                      onClick={() => handleReject(pref)}
                      className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 transition dark:text-red-300 dark:bg-red-900 dark:border-red-700 dark:hover:bg-red-800"
                    >
                      {state.loading ? '処理中...' : '却下'}
                    </button>
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
