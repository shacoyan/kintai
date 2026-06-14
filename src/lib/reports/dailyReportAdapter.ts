// =============================================================================
// lib/reports/dailyReportAdapter.ts — get_daily_report jsonb ⇄ 型 / フォーム ⇄ 行
// -----------------------------------------------------------------------------
// 設計書 §1.8 / §1.9 / §4.2 / §6。
//
//   - adaptDailyReport: RPC の jsonb（supabase-js は型推論しない）を防御的に
//     normalize して DailyReport へ確定する。全数値は Number(x)||0、null 許容は保持。
//   - formToDailyReportRow: フォーム入力 → daily_reports の列マップ（cash_count_*
//     9列に展開、cash_total は GENERATED なので含めない）。
//   - manualToForm: 既存 manual ブロック → フォーム初期値（prefill / reset 用）。
// =============================================================================

import { normalizeCashCounts } from './cashCount';
import {
  DENOMINATIONS,
  type DailyReport,
  type DailyReportForm,
  type CashCounts,
} from './types';

/** 任意値を有限数へ。NaN/null/undefined/Infinity は 0。 */
function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** 任意値を整数 | null（null 保持。非 null は丸め）。 */
function intOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** 真偽の防御的解釈。 */
function bool(raw: unknown): boolean {
  return raw === true;
}

/** 文字列 | null（空文字・非文字列は null）。 */
function strOrNull(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

function asObj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/**
 * get_daily_report の戻り jsonb を完全な DailyReport へ正規化する。
 * RPC が一部キーを欠いても落ちない（既定値で補完）。
 */
export function adaptDailyReport(raw: unknown): DailyReport {
  const root = asObj(raw);
  const square = asObj(root.square);
  const manual = asObj(root.manual);
  const labor = asObj(root.labor);
  const derived = asObj(root.derived);

  return {
    store_id: typeof root.store_id === 'string' ? root.store_id : '',
    store_name: typeof root.store_name === 'string' ? root.store_name : '',
    business_date: typeof root.business_date === 'string' ? root.business_date : '',
    scope_ok: bool(root.scope_ok),
    square: {
      total_amount: num(square.total_amount),
      open_total_amount: num(square.open_total_amount),
      cash_amount: num(square.cash_amount),
      card_amount: num(square.card_amount),
      external_amount: num(square.external_amount),
      other_amount: num(square.other_amount),
      transaction_count: num(square.transaction_count),
      new_customer_count: num(square.new_customer_count),
      repeat_customer_count: num(square.repeat_customer_count),
      regular_customer_count: num(square.regular_customer_count),
      staff_customer_count: num(square.staff_customer_count),
      customer_total: num(square.customer_total),
    },
    manual: {
      incentive: num(manual.incentive),
      expense_drink: num(manual.expense_drink),
      expense_food: num(manual.expense_food),
      expense_flavor: num(manual.expense_flavor),
      expense_supplies: num(manual.expense_supplies),
      expense_other: num(manual.expense_other),
      shisha_count: num(manual.shisha_count),
      cash_total: num(manual.cash_total),
      cash_counts: normalizeCashCounts(manual.cash_counts),
      pool_amount: num(manual.pool_amount),
      discrepancy_amount_manual: intOrNull(manual.discrepancy_amount_manual),
      note: strOrNull(manual.note),
      report_exists: bool(manual.report_exists),
    },
    labor: {
      parttime_labor: num(labor.parttime_labor),
      source: typeof labor.source === 'string' ? labor.source : 'unavailable',
    },
    derived: {
      // 未入力（算出不能）は null 保持（0 と区別＝「—」表示）。
      discrepancy_amount: intOrNull(derived.discrepancy_amount),
    },
  };
}

/**
 * DailyReport の manual ブロックをフォーム初期値へ。
 * prefill / 再取得時 reset に使う。
 */
export function manualToForm(report: DailyReport): DailyReportForm {
  const m = report.manual;
  return {
    incentive: m.incentive,
    expense_drink: m.expense_drink,
    expense_food: m.expense_food,
    expense_flavor: m.expense_flavor,
    expense_supplies: m.expense_supplies,
    expense_other: m.expense_other,
    shisha_count: m.shisha_count,
    cash_counts: normalizeCashCounts(m.cash_counts),
    pool_amount: m.pool_amount,
    discrepancy_amount: m.discrepancy_amount_manual, // null=自動
    note: m.note ?? '',
  };
}

/**
 * 金種マップを daily_reports の cash_count_<denom> 列へ展開する。
 * cash_total は GENERATED のため含めない。
 */
export function cashCountsToColumns(counts: CashCounts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const denom of DENOMINATIONS) {
    const v = Number(counts[String(denom)]);
    out[`cash_count_${denom}`] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  return out;
}

/**
 * フォーム入力 → daily_reports の列マップ（識別キー・監査列は呼び出し側で付与）。
 * cash_total は送らない（GENERATED）。discrepancy_amount は null（自動）/整数（手動上書き）。
 */
export function formToDailyReportRow(
  form: DailyReportForm
): Record<string, number | string | null> {
  return {
    incentive: num(form.incentive),
    expense_drink: num(form.expense_drink),
    expense_food: num(form.expense_food),
    expense_flavor: num(form.expense_flavor),
    expense_supplies: num(form.expense_supplies),
    expense_other: num(form.expense_other),
    shisha_count: num(form.shisha_count),
    ...cashCountsToColumns(form.cash_counts),
    discrepancy_amount: intOrNull(form.discrepancy_amount),
    pool_amount: Math.trunc(num(form.pool_amount)),
    note: form.note && form.note.length > 0 ? form.note : null,
  };
}
