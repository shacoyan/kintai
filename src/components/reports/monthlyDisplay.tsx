import React from 'react';
import { Lock } from 'lucide-react';
import { Badge } from '../ui';
import { formatYen } from './reportFormat';

// =============================================================================
// monthlyDisplay — 月報表示の共通整形・ロック表示（Loop E §5.2 / §5.4）
// -----------------------------------------------------------------------------
//   - 経営数値（固定費・社員人件費・売上目標生値・暫定利益額/率・営業利益額/率）は
//     RPC が staff に null を返す。UI は **fail-safe ロック表示**:
//       値が null → 「—」＋（managerial のときだけ）鍵 Badge「管理者のみ」。
//     ＝ロール判定漏れがあっても null なら無条件で伏せる（§5.4）。
//   - 金額は円のカンマ区切り（formatYen 流用＝/sales と同形式・万単位は使わない）。
//   - レート（達成率・利益率）は % 表示。
// =============================================================================

/** 達成率・利益率の % 表示。null/NaN は「—」。値は 0.xx でなく 0..100 の％想定。 */
export function formatRate(n: number | null | undefined): string {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

/** 円のロック対応表示（値 / null）。null は「—」を返す（ロック Badge は LockedValue 側）。 */
export function formatYenOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatYen(Number(n));
}

export interface LockedValueProps {
  /** 表示値（null = ロック）。 */
  value: number | null | undefined;
  /** 値の整形（既定: 円カンマ区切り）。 */
  format?: (n: number) => string;
  /** 管理者か（true なら null 時に「管理者のみ」Badge を出す）。 */
  isManagerial: boolean;
  className?: string;
}

/**
 * 経営数値セル。
 *   - 値あり → 整形値を表示。
 *   - 値 null → 「—」。managerial のときだけ鍵 Badge「管理者のみ」を併記
 *     （staff には Badge を出さず単に「—」。項目自体は見せて値だけ伏せる §5.4）。
 */
export const LockedValue: React.FC<LockedValueProps> = ({
  value,
  format = formatYen,
  isManagerial,
  className,
}) => {
  const locked = value == null || !Number.isFinite(Number(value));
  if (!locked) {
    return <span className={className}>{format(Number(value))}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-stone-400 ${className ?? ''}`}>
      <span aria-hidden>—</span>
      {isManagerial && (
        <Badge tone="neutral" icon={<Lock className="w-3 h-3" aria-hidden />}>
          管理者のみ
        </Badge>
      )}
      <span className="sr-only">{isManagerial ? '管理者のみ表示' : '非公開'}</span>
    </span>
  );
};
