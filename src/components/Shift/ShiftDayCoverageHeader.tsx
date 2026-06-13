import type { Shift } from '../../types';
import { computeSlotCoverage, judgeStaffing } from '../../utils/shiftSlot';
import { Badge } from '../ui/Badge';

interface Props {
  /** 表示対象日 (YYYY-MM-DD) = mobileSheetDate */
  date: string;
  /** 全件 or 自分（呼び出し側で渡す。本コンポーネントで日付・status フィルタする） */
  shifts: Shift[];
  /** 将来拡張用（自分強調等）。本版は未使用でも受ける。 */
  currentUserId: string | null;
}

/**
 * 日詳細シート上部のカバレッジ判定ヘッダ（注入方式・UnifiedShiftSidebar は非改変）。
 * - その日の「配置として数える」確定 shift（approved/tentative/modified）を抽出
 * - computeSlotCoverage で early/mid/late/total を集計
 * - judgeStaffing(total) で適正度を判定しチップ表示
 * - 早0 / 遅0 は警告色、中0 は通常色（中番は店舗により不要なため）
 */
export function ShiftDayCoverageHeader({ date, shifts }: Props): JSX.Element {
  const dayShifts = shifts.filter(
    (s) =>
      s.date === date &&
      (s.status === 'approved' || s.status === 'tentative' || s.status === 'modified'),
  );
  const coverage = computeSlotCoverage(dayShifts);
  const verdict = judgeStaffing(coverage.total);

  return (
    <div className="px-1 pb-2 mb-2 border-b border-stone-200 dark:border-stone-700">
      {/* 上段: 判定チップ */}
      <div className="flex items-center gap-2">
        <Badge tone={verdict.tone} withDot role="status">
          {verdict.label}
        </Badge>
        <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          確定 {coverage.total} 名
        </span>
      </div>

      {/* 下段: 早 / 中 / 遅 カバレッジ数値 */}
      <div className="mt-1.5 flex items-center gap-4 text-sm">
        <SlotStat label="早" value={coverage.early} warn={coverage.early === 0} />
        <SlotStat label="中" value={coverage.mid} warn={false} />
        <SlotStat label="遅" value={coverage.late} warn={coverage.late === 0} />
      </div>
    </div>
  );
}

function SlotStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn: boolean;
}): JSX.Element {
  const colorClass = warn
    ? 'text-orange-600 dark:text-orange-400'
    : 'text-stone-700 dark:text-stone-200';
  return (
    <span className={`inline-flex items-baseline gap-1 ${colorClass}`}>
      <span className="text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

export default ShiftDayCoverageHeader;
