import { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import type { ShiftPreference, ShiftPreferenceType, ShiftPreset, Store } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { ShiftPreferenceForm } from './ShiftPreferenceForm';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { formatSupabaseError } from '../../lib/errors';

/**
 * Loop15: カレンダーの preference アイテムを直接押したときに開く時間変更モーダル。
 * Loop16-C: preference を optional 化し、新規申請モードでも再利用できるようにする。
 *
 * - 既存 ShiftPreferenceForm を BottomSheet 内で再利用するラッパー。
 * - 自己仮承認 (2026-05-31): 店長/owner が自分の pending preferred 申請を仮承認できるよう、
 *   承認 UI セクションを内包する。フロー・文言は PreferenceAdminActionModal の承認部分と
 *   完全一致させる (reject は除く / 要同期)。共通抽出は回帰回避のため行わない。
 */

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

// PreferenceAdminActionModal と同一フロー (reject 除く / 要同期)
type Mode = 'menu' | 'confirmApprove' | 'pickTime' | 'confirmApproveWithTime';

export interface PreferenceTimeEditModalProps {
  /** 既存編集時の preference。新規申請時は undefined。 */
  preference?: ShiftPreference;
  /** 新規申請モード用の対象日付（preference 未指定時に使用）。 */
  newDate?: string;
  presets: ShiftPreset[];
  defaultStoreId: string | null;
  selectableStores: Store[];
  isDeadlinePassed?: boolean;
  canBypassDeadline?: boolean;
  /** 当該申請の店舗を管理できる店長/オーナーのとき true。承認 UI の表示可否。 */
  canApprove?: boolean;
  onSubmit: (
    date: string,
    type: ShiftPreferenceType,
    startTime?: string,
    endTime?: string,
    note?: string,
    storeId?: string,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 希望時間そのままで仮承認。canApprove=true かつ pending かつ !unavailable のときのみ呼ばれる。 */
  onApprove?: (id: string) => Promise<void> | void;
  /** 開始/終了を指定して仮承認。同上。 */
  onApproveWithTime?: (id: string, startTime: string, endTime: string) => Promise<void> | void;
  onClose: () => void;
}

export function PreferenceTimeEditModal({
  preference,
  newDate,
  presets,
  selectableStores,
  defaultStoreId,
  isDeadlinePassed = false,
  canBypassDeadline = false,
  canApprove = false,
  onSubmit,
  onDelete,
  onApprove,
  onApproveWithTime,
  onClose,
}: PreferenceTimeEditModalProps) {
  const [mode, setMode] = useState<Mode>('menu');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editStart, setEditStart] = useState<string>(preference?.start_time?.slice(0, 5) ?? '09:00');
  const [editEnd, setEditEnd] = useState<string>(preference?.end_time?.slice(0, 5) ?? '18:00');

  const targetDate = preference?.date ?? newDate;
  if (!targetDate) {
    // Loop16-C: 不正呼び出しを防ぐためのガード。preference / newDate のどちらも無い場合は何もしない。
    return null;
  }
  const title = preference
    ? `${targetDate} のシフト申請`
    : `${targetDate} の新規シフト申請`;

  // 承認 UI 表示ゲート (§3-3): 4 条件 AND + ハンドラ defined の防御ガード。
  const showApprovalSection =
    canApprove &&
    !!preference &&
    preference.status === 'pending' &&
    preference.preference_type !== 'unavailable' &&
    !!onApprove &&
    !!onApproveWithTime;

  const handleApprove = async (withTime: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (withTime) {
        await onApproveWithTime!(preference!.id, editStart, editEnd);
      } else {
        await onApprove!(preference!.id);
      }
      setLoading(false);
    } catch (err) {
      setError(formatSupabaseError(err).message);
      setLoading(false);
    }
  };

  const handlePresetApprove = async (startTime: string, endTime: string) => {
    setLoading(true);
    setError(null);
    try {
      await onApproveWithTime!(preference!.id, startTime, endTime);
      setLoading(false);
    } catch (err) {
      setError(formatSupabaseError(err).message);
      setLoading(false);
    }
  };

  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title={title}
    >
      <div className="space-y-4">
        {showApprovalSection && preference && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              店長として仮承認
            </h3>
            {error && (
              <div className="text-sm text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-800/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {mode === 'menu' && (
              <div className="space-y-2">
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  iconLeft={<Check className="w-4 h-4" />}
                  onClick={() => setMode('confirmApprove')}
                  disabled={loading}
                >
                  仮承認する
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  iconLeft={<Clock className="w-4 h-4" />}
                  onClick={() => setMode('pickTime')}
                  disabled={loading}
                >
                  時間指定で仮承認
                </Button>
              </div>
            )}

            {mode === 'confirmApprove' && (
              <div className="space-y-3">
                <p className="text-sm text-stone-700 dark:text-stone-200">
                  この申請を仮承認します。よろしいですか？
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => handleApprove(false)}
                    disabled={loading}
                  >
                    {loading && <Spinner size="sm" inline className="mr-1" />}仮承認する
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setMode('menu')}
                    disabled={loading}
                  >
                    戻す
                  </Button>
                </div>
              </div>
            )}

            {mode === 'pickTime' && (
              <div className="space-y-3">
                <p className="text-sm text-stone-700 dark:text-stone-200">
                  仮承認する時間を指定してください。
                </p>
                <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-2">
                  <div className="sm:contents">
                    <label className="text-xs text-stone-600 dark:text-stone-300 block sm:inline">開始</label>
                    <select
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      disabled={loading}
                      className="w-full sm:w-auto mt-1 sm:mt-0 text-sm rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 px-2 py-1"
                    >
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="sm:contents">
                    <label className="text-xs text-stone-600 dark:text-stone-300 block sm:inline sm:ml-2">終了</label>
                    <select
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      disabled={loading}
                      className="w-full sm:w-auto mt-1 sm:mt-0 text-sm rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 px-2 py-1"
                    >
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setMode('confirmApproveWithTime')}
                    disabled={loading}
                  >
                    次へ
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setMode('menu')}
                    disabled={loading}
                  >
                    戻す
                  </Button>
                </div>

                {presets && presets.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-700">
                    <p className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">プリセット</p>
                    <div className="space-y-2">
                      {presets.map((preset) => {
                        const startTime = preset.start_time.slice(0, 5);
                        const endTime = preset.end_time.slice(0, 5);
                        return (
                          <div key={preset.id} className="flex items-center justify-between gap-2">
                            <span className="text-sm text-stone-700 dark:text-stone-200">
                              {preset.name} {startTime} - {endTime}
                            </span>
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => handlePresetApprove(startTime, endTime)}
                              disabled={loading}
                              aria-label={`${preset.name} ${startTime}-${endTime} の時間で承認`}
                            >
                              {loading && <Spinner size="sm" inline className="mr-1" />}この時間で承認
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === 'confirmApproveWithTime' && (
              <div className="space-y-3">
                <p className="text-sm text-stone-700 dark:text-stone-200">
                  <span className="font-medium">{editStart} 〜 {editEnd}</span> でこの申請を仮承認します。よろしいですか？
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => handleApprove(true)}
                    disabled={loading}
                  >
                    {loading && <Spinner size="sm" inline className="mr-1" />}確定する
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setMode('pickTime')}
                    disabled={loading}
                  >
                    戻る
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={showApprovalSection ? 'border-t pt-4 mt-4' : undefined}>
          <ShiftPreferenceForm
            date={targetDate}
            existingPreference={preference}
            presets={presets}
            selectableStores={selectableStores}
            defaultStoreId={defaultStoreId}
            isDeadlinePassed={isDeadlinePassed}
            canBypassDeadline={canBypassDeadline}
            onSubmit={onSubmit}
            onDelete={onDelete}
            onCancel={onClose}
          />
        </div>
      </div>
    </BottomSheet>
  );
}
