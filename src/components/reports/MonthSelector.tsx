import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, Select } from '../ui';

// =============================================================================
// MonthSelector — 月報の年月セレクタ（前月 / 次月送り）（Loop E §5.1）
// -----------------------------------------------------------------------------
//   - 年 Select + 月 Select + 「前月」「次月」IconButton。
//   - 既定値は呼び出し側（MonthlyReportPanel）が getBusinessDate(11) の年月で渡す。
//   - 値は (year, month) を 1 始まり月で扱う（month = 1..12）。
//   - 1 月の前 → 前年 12 月、12 月の次 → 翌年 1 月へ繰り上げ／繰り下げ。
//   - グラフ等は持たない純粋な制御コンポーネント。
// =============================================================================

export interface MonthSelectorProps {
  year: number;
  month: number; // 1..12
  onChange: (year: number, month: number) => void;
  /** 選択可能な年の範囲（既定: 現在年-3 〜 現在年）。 */
  minYear?: number;
  maxYear?: number;
  disabled?: boolean;
  className?: string;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  // month は 1..12。0 始まりに直して加算し、戻す。
  const zero = (year * 12 + (month - 1)) + delta;
  const y = Math.floor(zero / 12);
  const m = (zero % 12 + 12) % 12; // 負対策
  return { year: y, month: m + 1 };
}

export const MonthSelector: React.FC<MonthSelectorProps> = ({
  year,
  month,
  onChange,
  minYear,
  maxYear,
  disabled = false,
  className,
}) => {
  const thisYear = new Date().getFullYear();
  const lo = minYear ?? thisYear - 3;
  const hi = maxYear ?? thisYear;

  const yearOptions = useMemo(
    () =>
      Array.from({ length: hi - lo + 1 }, (_, i) => {
        const y = lo + i;
        return { value: String(y), label: `${y}年` };
      }),
    [lo, hi],
  );

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: `${i + 1}月`,
      })),
    [],
  );

  const goPrev = () => {
    const next = shiftMonth(year, month, -1);
    onChange(next.year, next.month);
  };
  const goNext = () => {
    const next = shiftMonth(year, month, +1);
    onChange(next.year, next.month);
  };

  return (
    <div className={`flex items-end gap-2 ${className ?? ''}`}>
      <IconButton
        aria-label="前月"
        variant="secondary"
        size="md"
        onClick={goPrev}
        disabled={disabled}
        icon={<ChevronLeft className="w-4 h-4" aria-hidden />}
      />

      <Select
        label="年"
        size="md"
        value={String(year)}
        disabled={disabled}
        options={yearOptions}
        onChange={(e) => onChange(Number(e.target.value), month)}
      />
      <Select
        label="月"
        size="md"
        value={String(month)}
        disabled={disabled}
        options={monthOptions}
        onChange={(e) => onChange(year, Number(e.target.value))}
      />

      <IconButton
        aria-label="次月"
        variant="secondary"
        size="md"
        onClick={goNext}
        disabled={disabled}
        icon={<ChevronRight className="w-4 h-4" aria-hidden />}
      />
    </div>
  );
};

export default MonthSelector;
