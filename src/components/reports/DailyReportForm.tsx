// =============================================================================
// components/reports/DailyReportForm.tsx — 日報入力フォーム本体（§4.4）
// -----------------------------------------------------------------------------
//   - 支出6 / シーシャ本数 / 金種9（現金合計リアルタイム）/ プール金 / 備考 /
//     違算（自動＋折りたたみ手動上書き）。
//   - 非負整数バリデーション（プール金・手動違算は符号許容）。
//   - 保存中は loading で全 disabled。成功 toast + reload は上位（hook の saveDailyReport）。
//   - cash_total は送らない（GENERATED）。クライアントは cashTotal 純関数で表示のみ。
//   - モバイル: 金種は inputMode='numeric' でテンキー。1 カラム縦積み。
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Textarea, Button, Badge } from '../ui';
import { useToast } from '../../contexts/ToastContext';
import { cashTotal } from '../../lib/reports/cashCount';
import { manualToForm } from '../../lib/reports/dailyReportAdapter';
import { DENOMINATIONS } from '../../lib/reports/types';
import type { DailyReport, DailyReportForm as FormState, CashCounts } from '../../lib/reports/types';
import { formatYen, formatSignedYen, discrepancyTone } from './reportFormat';

interface DailyReportFormProps {
  report: DailyReport;
  saving: boolean;
  onSave: (form: FormState) => Promise<void>;
}

// 支出6フィールドの定義（非負整数）。
const EXPENSE_FIELDS: { key: keyof FormState; label: string }[] = [
  { key: 'incentive', label: 'インセンティブ' },
  { key: 'expense_drink', label: '酒代' },
  { key: 'expense_food', label: 'フード' },
  { key: 'expense_flavor', label: 'フレーバー' },
  { key: 'expense_supplies', label: '消耗品' },
  { key: 'expense_other', label: 'その他' },
];

// 金種ラベル（額面 → 表示名）。
const DENOM_LABEL: Record<number, string> = {
  10000: '1万円',
  5000: '5千円',
  1000: '千円',
  500: '500円',
  100: '100円',
  50: '50円',
  10: '10円',
  5: '5円',
  1: '1円',
};

/** 文字列入力を数値へ。空は 0。 */
function toNum(raw: string): number {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** 非負整数か（空＝0 は許容）。 */
function isNonNegInt(raw: string): boolean {
  if (raw.trim() === '') return true;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/** 整数（符号許容）か（空＝0 は許容）。 */
function isInt(raw: string): boolean {
  if (raw.trim() === '') return true;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n);
}

export function DailyReportForm({ report, saving, onSave }: DailyReportFormProps): JSX.Element {
  const { showToast } = useToast();

  // フォーム値は文字列で保持（入力途中の検証のため）。初期値は manual から復元。
  const initial = useMemo(() => manualToForm(report), [report]);

  // 数値フィールド（支出6 + シーシャ本数 + プール金）。
  const [fields, setFields] = useState<Record<string, string>>(() => buildFieldStrings(initial));
  // 金種は文字列 state で保持（他フィールドと同形・"-"/"abc" の NaN スタック回避／P2-3）。
  const [cashCounts, setCashCounts] = useState<Record<string, string>>(() =>
    buildCashStrings(initial.cash_counts),
  );
  const [note, setNote] = useState<string>(initial.note);

  // 違算手動上書き。null=自動。
  const [manualOverride, setManualOverride] = useState<boolean>(
    initial.discrepancy_amount !== null
  );
  const [manualDiscrepancy, setManualDiscrepancy] = useState<string>(
    initial.discrepancy_amount !== null ? String(initial.discrepancy_amount) : ''
  );

  // report（store/date 切替・保存後 reload）が変わるたびフォームを reset。
  useEffect(() => {
    const f = manualToForm(report);
    setFields(buildFieldStrings(f));
    setCashCounts(buildCashStrings(f.cash_counts));
    setNote(f.note);
    setManualOverride(f.discrepancy_amount !== null);
    setManualDiscrepancy(f.discrepancy_amount !== null ? String(f.discrepancy_amount) : '');
  }, [report]);

  // 現金合計（リアルタイム・送信しない表示専用）。文字列→数値へ純変換（NaN は 0）。
  const liveCashTotal = useMemo(() => cashTotal(parseCounts(cashCounts)), [cashCounts]);

  // 自動違算 = 現金合計（金種ライブ） − Square 現金。
  // RPC の derived.discrepancy_amount は保存時点のスナップショットで金種入力に
  // 追従しないため、フロントで再算出してライブ更新する（金種を打ち替えると即反映）。
  // ただし金種が一切未入力（現金合計0）かつ derived も null（未入力）のときは、
  // 0 と「未入力」を区別して null（「—」表示）にする。
  const autoDiscrepancy: number | null =
    liveCashTotal === 0 && report.derived.discrepancy_amount === null
      ? null
      : liveCashTotal - report.square.cash_amount;
  // 表示中の違算（手動 ON なら手動値、OFF なら自動値）。
  const shownDiscrepancy: number | null = manualOverride
    ? (manualDiscrepancy.trim() === '' ? 0 : Number(manualDiscrepancy))
    : autoDiscrepancy;

  // バリデーション集計。
  const expenseErrors = EXPENSE_FIELDS.some((f) => !isNonNegInt(fields[f.key as string] ?? ''));
  const poolError = !isInt(fields.pool_amount ?? '');
  const cashCountError = DENOMINATIONS.some(
    (d) => !isNonNegInt(cashCounts[String(d)] ?? '')
  );
  const manualDiscrepancyError = manualOverride && !isInt(manualDiscrepancy);
  const hasError =
    expenseErrors || poolError || cashCountError || manualDiscrepancyError;

  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const setDenom = (denom: number, value: string) =>
    setCashCounts((prev) => ({ ...prev, [String(denom)]: value }));

  const handleSubmit = async () => {
    if (hasError || saving) return;

    const form: FormState = {
      incentive: toNum(fields.incentive ?? ''),
      expense_drink: toNum(fields.expense_drink ?? ''),
      expense_food: toNum(fields.expense_food ?? ''),
      expense_flavor: toNum(fields.expense_flavor ?? ''),
      expense_supplies: toNum(fields.expense_supplies ?? ''),
      expense_other: toNum(fields.expense_other ?? ''),
      cash_counts: normalizeCounts(parseCounts(cashCounts)),
      pool_amount: toNum(fields.pool_amount ?? ''),
      discrepancy_amount: manualOverride
        ? (manualDiscrepancy.trim() === '' ? 0 : Math.trunc(Number(manualDiscrepancy)))
        : null,
      note,
    };

    try {
      await onSave(form);
      showToast('日報を保存しました', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存に失敗しました';
      showToast(message, 'error');
    }
  };

  const numProps = {
    type: 'number',
    inputMode: 'numeric' as const,
    min: 0,
  };

  return (
    <div className="space-y-4">
      {/* 支出 */}
      <Card padding="md">
        <Card.Header>支出</Card.Header>
        <Card.Body>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {EXPENSE_FIELDS.map((f) => (
              <Input
                key={f.key as string}
                label={f.label}
                {...numProps}
                value={fields[f.key as string] ?? ''}
                onChange={(e) => setField(f.key as string, e.target.value)}
                error={!isNonNegInt(fields[f.key as string] ?? '') ? '0 以上の整数で入力' : undefined}
                disabled={saving}
                rightSlot={<span className="text-xs text-stone-400">円</span>}
              />
            ))}
          </div>
        </Card.Body>
      </Card>

      {/* 金種 + 現金合計 */}
      <Card padding="md">
        <Card.Header>金種（枚数）</Card.Header>
        <Card.Body>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {DENOMINATIONS.map((denom) => {
              const v = cashCounts[String(denom)] ?? '';
              return (
                <Input
                  key={denom}
                  label={DENOM_LABEL[denom]}
                  {...numProps}
                  value={v}
                  onChange={(e) => setDenom(denom, e.target.value)}
                  error={!isNonNegInt(v) ? '0 以上' : undefined}
                  disabled={saving}
                  rightSlot={<span className="text-xs text-stone-400">枚</span>}
                />
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-md bg-stone-50 px-4 py-3 dark:bg-stone-800">
            <span className="text-sm text-stone-600 dark:text-stone-300">現金合計</span>
            <span className="text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {formatYen(liveCashTotal)}
            </span>
          </div>
        </Card.Body>
      </Card>

      {/* 違算 + プール金 + 備考 */}
      <Card padding="md">
        <Card.Header>違算・プール金・備考</Card.Header>
        <Card.Body>
          {/* 違算（自動表示） */}
          <div className="flex items-center justify-between rounded-md border border-stone-200 px-4 py-3 dark:border-stone-700">
            <div>
              <p className="text-sm text-stone-600 dark:text-stone-300">違算（過不足）</p>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                現金合計 − Square 現金。プラス＝過剰 / マイナス＝不足。
              </p>
            </div>
            <Badge tone={shownDiscrepancy === null ? 'neutral' : discrepancyTone(shownDiscrepancy)}>
              {/* 未入力（null）は ±0 でなく「—」（0 一致と区別）。 */}
              {shownDiscrepancy === null ? '—' : formatSignedYen(shownDiscrepancy)}
            </Badge>
          </div>

          {/* 上級項目: 違算の手動上書き（折りたたみ） */}
          <details className="mt-3 rounded-md border border-stone-200 dark:border-stone-700">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-stone-700 dark:text-stone-300">
              上級項目（違算を手動で上書き）
            </summary>
            <div className="border-t border-stone-200 px-4 py-3 dark:border-stone-700">
              <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={manualOverride}
                  onChange={(e) => setManualOverride(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-stone-300 dark:border-stone-600"
                />
                違算を手動で上書きする
              </label>
              {manualOverride ? (
                <div className="mt-3 max-w-xs">
                  <Input
                    label="違算（手動・符号許容）"
                    type="number"
                    inputMode="numeric"
                    value={manualDiscrepancy}
                    onChange={(e) => setManualDiscrepancy(e.target.value)}
                    error={manualDiscrepancyError ? '整数で入力（マイナス可）' : undefined}
                    disabled={saving}
                    rightSlot={<span className="text-xs text-stone-400">円</span>}
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                  オフのとき自動算出（{autoDiscrepancy === null ? '—' : formatSignedYen(autoDiscrepancy)}）を保存します。
                </p>
              )}
            </div>
          </details>

          {/* プール金（符号許容） */}
          <div className="mt-4 max-w-xs">
            <Input
              label="プール金（持ち出しはマイナス可）"
              type="number"
              inputMode="numeric"
              value={fields.pool_amount ?? ''}
              onChange={(e) => setField('pool_amount', e.target.value)}
              error={poolError ? '整数で入力（マイナス可）' : undefined}
              disabled={saving}
              rightSlot={<span className="text-xs text-stone-400">円</span>}
            />
          </div>

          {/* 備考 */}
          <div className="mt-4">
            <Textarea
              label="備考"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
        </Card.Body>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="primary"
          loading={saving}
          disabled={hasError}
          onClick={handleSubmit}
        >
          日報を保存
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** フォーム初期値（数値）を文字列マップへ（0 は空文字でプレースホルダ的に）。 */
function buildFieldStrings(f: FormState): Record<string, string> {
  const s = (n: number) => (n === 0 ? '' : String(n));
  return {
    incentive: s(f.incentive),
    expense_drink: s(f.expense_drink),
    expense_food: s(f.expense_food),
    expense_flavor: s(f.expense_flavor),
    expense_supplies: s(f.expense_supplies),
    expense_other: s(f.expense_other),
    pool_amount: f.pool_amount === 0 ? '' : String(f.pool_amount),
  };
}

/** CashCounts（数値）→ 文字列マップ（0 は空文字でプレースホルダ的に）。 */
function buildCashStrings(counts: CashCounts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DENOMINATIONS) {
    const n = Number(counts[String(d)]);
    out[String(d)] = Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '';
  }
  return out;
}

/** 文字列マップ → CashCounts（数値・NaN/不正は 0）。表示計算・保存前変換用。 */
function parseCounts(counts: Record<string, string>): CashCounts {
  const out: CashCounts = {};
  for (const d of DENOMINATIONS) {
    const n = Number(counts[String(d)]);
    out[String(d)] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** CashCounts の各値を非負整数に正規化（保存前の最終クレンジング）。 */
function normalizeCounts(counts: CashCounts): CashCounts {
  const out: CashCounts = {};
  for (const d of DENOMINATIONS) {
    const raw = Number(counts[String(d)]);
    out[String(d)] = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }
  return out;
}
