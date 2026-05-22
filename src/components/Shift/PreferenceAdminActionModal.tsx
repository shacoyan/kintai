import { useState } from 'react';
import { Check, X, Clock } from 'lucide-react';
import type { ShiftPreference, ShiftPreset } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatSupabaseError } from '../../lib/errors';
import { formatTimeRange } from '../../utils/formatTimeRange';

/**
 * Loop16-B: 他人の preference をカレンダーから直接押したときの管理アクションモーダル。
 *
 * - BottomSheet ベース。
 * - アクション: 仮承認 / 時間指定で仮承認 / 却下。
 * - 確認 → 実行の 2 段階フロー（PreferenceActionRow と同等）。
 * - Loop追加: pickTime モードにプリセット一覧を表示し、「この時間で承認」でワンクリック承認可能。
 */
export interface PreferenceAdminActionModalProps {
  preference: ShiftPreference;
  memberName?: string;
  storeName?: string;
  presets?: ShiftPreset[];
  /** startTime/endTime 省略時は preference の希望時間そのまま、指定時はその時刻で仮承認。 */
  onApprove: (id: string, startTime?: string, endTime?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onClose: () => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
  }
}

// Reviewer P2: pickTime の後に確認ステップ (confirmApproveWithTime) を挟む。
// ヘッダコメント「確認 → 実行の 2 段階フロー」と挙動を一致させる。
type Mode = 'menu' | 'confirmApprove' | 'pickTime' | 'confirmApproveWithTime' | 'confirmReject';

export function PreferenceAdminActionModal({
  preference,
  memberName,
  storeName,
  presets,
  onApprove,
  onReject,
  onClose,
}: PreferenceAdminActionModalProps) {
  const [mode, setMode] = useState<Mode>('menu');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editStart, setEditStart] = useState<string>(preference.start_time?.slice(0, 5) ?? '09:00');
  const [editEnd, setEditEnd] = useState<string>(preference.end_time?.slice(0, 5) ?? '18:00');

  const isUnavailable = preference.preference_type === 'unavailable';
  const timeLabel = preference.start_time && preference.end_time
    ? formatTimeRange(preference.start_time, preference.end_time, { compactNextDay: true })
    : isUnavailable ? '出勤不可' : '時間未指定';

  const handleApprove = async (withTime: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (withTime) {
        await onApprove(preference.id, editStart, editEnd);
      } else {
        await onApprove(preference.id);
      }
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
      setLoading(false);
    }
  };

  const handlePresetApprove = async (startTime: string, endTime: string) => {
    setLoading(true);
    setError(null);
    try {
      await onApprove(preference.id, startTime, endTime);
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await onReject(preference.id);
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
      setLoading(false);
    }
  };

  return (
    <BottomSheet
      isOpen={true}
      onClose={onClose}
      title="シフト申請の管理"
    >
      <div className="space-y-4">
        {/* 申請内容サマリ */}
        <div className="rounded-md bg-stone-50 dark:bg-stone-800 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
              {memberName ?? '不明なメンバー'}
            </span>
            {storeName && (
              <Badge tone="neutral">{storeName}</Badge>
            )}
          </div>
          <div className="text-xs text-stone-600 dark:text-stone-300">
            {preference.date}
          </div>
          <div className="text-sm text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
            {timeLabel}
          </div>
          {preference.note && (
            <div className="text-xs text-stone-600 dark:text-stone-300 pt-1 border-t border-stone-200 dark:border-stone-700">
              {preference.note}
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-800/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* メイン: アクション選択
            Reviewer P2: unavailable preference (= 出勤不可申請) は「仮承認」「時間指定で仮承認」を非表示。
            既存 PreferenceActionRow の !isUnavailable ガードと整合性を取る。却下のみ可能。 */}
        {mode === 'menu' && (
          <div className="space-y-2">
            {!isUnavailable && (
              <>
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
              </>
            )}
            <Button
              variant="danger"
              size="md"
              fullWidth
              iconLeft={<X className="w-4 h-4" />}
              onClick={() => setMode('confirmReject')}
              disabled={loading}
            >
              却下する
            </Button>
          </div>
        )}

        {/* 確認: 仮承認 */}
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

        {/* 時間指定 → 確認 (Reviewer P2: ここでは時刻入力のみ、実行は confirmApproveWithTime で確認後)
            プリセット拡張: presets が渡されていれば下部にプリセット一覧 + ワンクリック承認 (variant=success) を表示。 */}
        {mode === 'pickTime' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-700 dark:text-stone-200">
              仮承認する時間を指定してください。
            </p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-stone-600 dark:text-stone-300">開始</label>
              <select
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                disabled={loading}
                className="text-sm rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 px-2 py-1"
              >
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="text-xs text-stone-600 dark:text-stone-300 ml-2">終了</label>
              <select
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                disabled={loading}
                className="text-sm rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 px-2 py-1"
              >
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
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

        {/* 確認: 時間指定で仮承認 (Reviewer P2: 確認 → 実行の 2 段階フローを完成させる) */}
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

        {/* 確認: 却下 */}
        {mode === 'confirmReject' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-700 dark:text-stone-200">
              この申請を却下します。よろしいですか？
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="md"
                onClick={handleReject}
                disabled={loading}
              >
                {loading && <Spinner size="sm" inline className="mr-1" />}却下する
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
      </div>
    </BottomSheet>
  );
}
