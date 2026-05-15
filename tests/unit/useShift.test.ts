// kintai/tests/unit/useShift.test.ts
//
// 設計書: .company/engineering/docs/2026-05-15-kintai-tentative-approval-loop1-techdesign.md §9.1
//
// === 現状の前提 ===
// kintai プロジェクトには vitest / jest / @testing-library/react が未導入のため、
// このテストファイルは Loop 1 時点では「実行されないテストケース記述」となる。
// 実行可能化は以下の前提が揃った後 (Engineer B + 秘書/Tech Lead に申し送り):
//   1. devDependencies に vitest + @testing-library/react + jsdom を追加
//   2. useShift.ts 内部の getLaborCostEstimate を src/utils/laborCost.ts へ純粋関数として切り出し
//      (hook 内 useCallback のままだと renderHook 経由でしかアクセスできず、Supabase mock が重くなる)
//   3. package.json scripts に "test:unit": "vitest run" を追加
//
// === テストケース概要 (設計書 §9.1) ===
// getLaborCostEstimate を pending / tentative / approved 混在 shifts で呼び、
// 仮承認分のみフィルタしたときの合算と全体集計の両方の正しさを検証する。
//
// ケース 1: hourly メンバー / pending 1 件 + tentative 1 件 (各 09:00-18:00)
//   - tentative のみフィルタ → 9h * 1500 = 13500
//   - 全体 (pending + tentative) → 18h * 1500 = 27000
//
// ケース 2: hourly メンバー / tentative 1 件 (22:00-05:00, night_shift_enabled=true)
//   - 通常 1h + 深夜 6h → Math.ceil(1*1500 + 6*1500*1.25) = Math.ceil(12750) = 12750
//   - 深夜帯の境界は src/lib/nightShift.ts の getNightMinutesForShift に委譲
//
// ケース 3: monthly メンバー / tentative 1 件 / monthly_salary=250000
//   - シフト時間に関わらず estimatedCost = 250000 固定
//
// ケース 4: approved 1 件 + tentative 1 件 / tentative フィルタ → approved 除外
//   - tentative のみ → 13500
//   - 全体 → 27000
//
// === 実装メモ ===
// getLaborCostEstimate のシグネチャ:
//   getLaborCostEstimate(shifts: Shift[], members: TenantMember[]): LaborCostEstimate[]
// 戻り値はメンバーごとの { userId, displayName, payType, shiftMinutes, nightMinutes, estimatedCost } 配列。
// 仮承認分の集計は呼び出し側で shifts.filter(s => s.status === 'tentative') してから渡す方式。
// (ShiftPage.tsx の laborEstimates useMemo で実装済み)
//
// 期待値の検証は:
//   const estimates = getLaborCostEstimate(filteredShifts, members);
//   const totalCost = estimates.reduce((s, e) => s + e.estimatedCost, 0);
//   expect(totalCost).toBe(EXPECTED);
//
// Shift 型: src/types/index.ts の Shift。主要フィールド:
//   { id, tenant_id, store_id, user_id, date: 'YYYY-MM-DD', start_time: 'HH:MM',
//     end_time: 'HH:MM', status, created_at, updated_at }
// TenantMember 型: { user_id, display_name, pay_type: 'hourly'|'monthly',
//   hourly_rate, monthly_salary, night_shift_enabled, ... }
//
// vitest 導入後の実装テンプレート (下記コメントを外して使う):
/*
import { describe, it, expect } from 'vitest';
import { getLaborCostEstimate } from '../../src/utils/laborCost'; // ← B が切り出し後の path

const baseShift = {
  tenant_id: 't1', store_id: 's1', user_id: 'u1',
  date: '2026-06-01', created_at: '', updated_at: '',
};
const hourlyMember = {
  user_id: 'u1', display_name: 'テスト太郎',
  pay_type: 'hourly' as const, hourly_rate: 1500,
  monthly_salary: 0, night_shift_enabled: true,
};
const monthlyMember = {
  user_id: 'u1', display_name: '月給太郎',
  pay_type: 'monthly' as const, hourly_rate: 0,
  monthly_salary: 250000, night_shift_enabled: true,
};

describe('getLaborCostEstimate', () => {
  it('ケース1: pending+tentative 混在で tentative フィルタ / 全体集計が正しい', () => {
    const shifts = [
      { ...baseShift, id: 's1', start_time: '09:00', end_time: '18:00', status: 'pending' as const },
      { ...baseShift, id: 's2', date: '2026-06-02', start_time: '09:00', end_time: '18:00', status: 'tentative' as const },
    ];
    const tentativeOnly = shifts.filter(s => s.status === 'tentative');
    const tentTotal = getLaborCostEstimate(tentativeOnly, [hourlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(tentTotal).toBe(13500);

    const allTotal = getLaborCostEstimate(shifts, [hourlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(allTotal).toBe(27000);
  });

  it('ケース2: hourly 深夜シフト 22:00-05:00 で深夜 1.25 倍が適用される', () => {
    const shifts = [
      { ...baseShift, id: 's3', start_time: '22:00', end_time: '05:00', status: 'tentative' as const },
    ];
    const total = getLaborCostEstimate(shifts, [hourlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(total).toBe(12750);
  });

  it('ケース3: monthly メンバーは monthly_salary 固定で集計される', () => {
    const shifts = [
      { ...baseShift, id: 's4', start_time: '09:00', end_time: '18:00', status: 'tentative' as const },
    ];
    const total = getLaborCostEstimate(shifts, [monthlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(total).toBe(250000);
  });

  it('ケース4: approved+tentative 混在で tentative フィルタ時に approved が除外される', () => {
    const shifts = [
      { ...baseShift, id: 's5', start_time: '09:00', end_time: '18:00', status: 'approved' as const },
      { ...baseShift, id: 's6', date: '2026-06-02', start_time: '09:00', end_time: '18:00', status: 'tentative' as const },
    ];
    const tentativeOnly = shifts.filter(s => s.status === 'tentative');
    const tentTotal = getLaborCostEstimate(tentativeOnly, [hourlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(tentTotal).toBe(13500);

    const allTotal = getLaborCostEstimate(shifts, [hourlyMember]).reduce((s, e) => s + e.estimatedCost, 0);
    expect(allTotal).toBe(27000);
  });
});
*/

export {}; // module 化 (tsc がこのファイルを script ではなく module として扱うため)
