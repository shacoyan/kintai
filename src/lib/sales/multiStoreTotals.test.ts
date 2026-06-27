import { describe, it, expect } from 'vitest';
import {
  computeMultiStoreDailyTotals,
  type StoreDailyEntry,
} from './multiStoreTotals';

const store = (
  storeName: string,
  partial: Partial<Omit<StoreDailyEntry, 'storeName'>> = {},
): StoreDailyEntry => ({
  storeName,
  settledTotal: 0,
  settledCount: 0,
  openTotal: 0,
  openCount: 0,
  error: null,
  ...partial,
});

describe('computeMultiStoreDailyTotals', () => {
  // ---------------------------------------------------------------------------
  // T1: 空 / null / undefined
  // ---------------------------------------------------------------------------
  it('空配列はすべて0・complete=true(集計対象なし=矛盾なし)', () => {
    const r = computeMultiStoreDailyTotals([]);
    expect(r).toEqual({
      settledTotal: 0,
      settledCount: 0,
      openTotal: 0,
      openCount: 0,
      grandTotal: 0,
      grandCount: 0,
      storeCount: 0,
      succeededCount: 0,
      failedStores: [],
      anyError: false,
      complete: true,
    });
  });

  it('null/undefined は空配列扱い', () => {
    expect(computeMultiStoreDailyTotals(null).storeCount).toBe(0);
    expect(computeMultiStoreDailyTotals(undefined).complete).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // T2: 単一店舗
  // ---------------------------------------------------------------------------
  it('単一店舗: そのままの値・grand=settled+open', () => {
    const r = computeMultiStoreDailyTotals([
      store('souq', {
        settledTotal: 1000,
        settledCount: 5,
        openTotal: 200,
        openCount: 2,
      }),
    ]);
    expect(r.settledTotal).toBe(1000);
    expect(r.settledCount).toBe(5);
    expect(r.openTotal).toBe(200);
    expect(r.openCount).toBe(2);
    expect(r.grandTotal).toBe(1200);
    expect(r.grandCount).toBe(7);
    expect(r.storeCount).toBe(1);
    expect(r.succeededCount).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.anyError).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // T3: 複数店舗の和 + インバリアント(全店grand = Σ各店)
  // ---------------------------------------------------------------------------
  it('複数店舗: 金額・件数とも単純和(二重計上なし)', () => {
    const entries = [
      store('A', { settledTotal: 1000, settledCount: 4, openTotal: 100, openCount: 1 }),
      store('B', { settledTotal: 2500, settledCount: 9, openTotal: 0, openCount: 0 }),
      store('C', { settledTotal: 300, settledCount: 2, openTotal: 700, openCount: 3 }),
    ];
    const r = computeMultiStoreDailyTotals(entries);
    expect(r.settledTotal).toBe(3800);
    expect(r.settledCount).toBe(15);
    expect(r.openTotal).toBe(800);
    expect(r.openCount).toBe(4);
    expect(r.grandTotal).toBe(4600);
    expect(r.grandCount).toBe(19);
    expect(r.storeCount).toBe(3);
    expect(r.succeededCount).toBe(3);
  });

  it('インバリアント: 全店grandTotal = Σ各店(settled+open)・grandCount = Σ各店件数', () => {
    const entries = [
      store('A', { settledTotal: 1234, settledCount: 7, openTotal: 56, openCount: 1 }),
      store('B', { settledTotal: 9999, settledCount: 33, openTotal: 1, openCount: 1 }),
      store('C', { settledTotal: 0, settledCount: 0, openTotal: 4321, openCount: 12 }),
    ];
    const r = computeMultiStoreDailyTotals(entries);
    const expectGrand = entries.reduce(
      (s, e) => s + e.settledTotal + e.openTotal,
      0,
    );
    const expectGrandCount = entries.reduce(
      (s, e) => s + e.settledCount + e.openCount,
      0,
    );
    expect(r.grandTotal).toBe(expectGrand);
    expect(r.grandCount).toBe(expectGrandCount);
    expect(r.grandTotal).toBe(r.settledTotal + r.openTotal);
    expect(r.grandCount).toBe(r.settledCount + r.openCount);
  });

  // ---------------------------------------------------------------------------
  // T4: NaN / 欠落フィールドの吸収
  // ---------------------------------------------------------------------------
  it('NaN/欠落フィールドは toFiniteNumber で 0 化(NaN伝播なし)', () => {
    // 契約変更に対する防御確認: 欠落フィールド/NaN/undefined/文字列を意図的に混入。
    // 型を外して(unknown→StoreDailyEntry[]) ランタイム防御を検証する。
    const entries: unknown[] = [
      { storeName: 'A', error: null }, // 数値フィールド全欠落
      {
        storeName: 'B',
        settledTotal: NaN,
        settledCount: undefined,
        openTotal: 'abc',
        openCount: 3,
        error: null,
      },
      { storeName: 'C', settledTotal: 500, settledCount: 2, openTotal: 100, openCount: 1, error: null },
    ];
    const r = computeMultiStoreDailyTotals(entries as StoreDailyEntry[]);
    expect(Number.isNaN(r.settledTotal)).toBe(false);
    expect(Number.isNaN(r.grandTotal)).toBe(false);
    // A=全0, B=settled0/open0/count3, C=500/2/100/1
    expect(r.settledTotal).toBe(500);
    expect(r.settledCount).toBe(2);
    expect(r.openTotal).toBe(100);
    expect(r.openCount).toBe(4); // B:3 + C:1
    expect(r.grandTotal).toBe(600);
    expect(r.succeededCount).toBe(3);
    expect(r.complete).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // T5: 一部の店舗が 0 売上(成功・error なし)は合算対象
  // ---------------------------------------------------------------------------
  it('売上0の成功店は合算対象(complete維持・succeededに数える)', () => {
    const r = computeMultiStoreDailyTotals([
      store('A', { settledTotal: 1000, settledCount: 3, openTotal: 0, openCount: 0 }),
      store('B'), // すべて0・error なし(開店前で売上ゼロ等)
    ]);
    expect(r.grandTotal).toBe(1000);
    expect(r.storeCount).toBe(2);
    expect(r.succeededCount).toBe(2);
    expect(r.complete).toBe(true);
    expect(r.failedStores).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T6: 取得失敗店は合計から除外(過少表示の禁止 → complete=false で不可知通知)
  // ---------------------------------------------------------------------------
  it('error 店は合計に算入せず failedStores/anyError/complete=false で通知', () => {
    const r = computeMultiStoreDailyTotals([
      store('A', { settledTotal: 1000, settledCount: 3, openTotal: 200, openCount: 1 }),
      store('B', { error: 'fetch failed: 503 Service Unavailable' }),
      store('C', { settledTotal: 500, settledCount: 2, openTotal: 0, openCount: 0 }),
    ]);
    // 合計は成功店 A+C のみ。失敗店 B は ¥0 として算入しない。
    expect(r.settledTotal).toBe(1500);
    expect(r.openTotal).toBe(200);
    expect(r.grandTotal).toBe(1700);
    expect(r.grandCount).toBe(6); // A:(3+1) + C:(2+0)
    expect(r.storeCount).toBe(3);
    expect(r.succeededCount).toBe(2);
    expect(r.failedStores).toEqual(['B']);
    expect(r.anyError).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('FIX-1: 店舗ID未解決店(error 付き)は合計から除外し complete=false(サイレント脱落の禁止)', () => {
    // SalesPage は id 未解決店も渡し、hook が「店舗ID未解決」error 付き entry にする。
    // 純関数はそれを通常の失敗店と同様に除外し complete=false で不可知を通知する。
    const r = computeMultiStoreDailyTotals([
      store('解決済A', { settledTotal: 800, settledCount: 2, openTotal: 100, openCount: 1 }),
      store('未解決B', {
        error: '店舗IDを解決できませんでした（locations_meta 未登録の可能性があります）',
      }),
    ]);
    expect(r.settledTotal).toBe(800);
    expect(r.openTotal).toBe(100);
    expect(r.grandTotal).toBe(900);
    expect(r.failedStores).toEqual(['未解決B']);
    expect(r.succeededCount).toBe(1);
    expect(r.storeCount).toBe(2);
    expect(r.anyError).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('error 店が値も持っていても合算に混入しない(過少/過大表示の禁止)', () => {
    // 取得途中の不完全値が残っていても error あれば除外する。
    const r = computeMultiStoreDailyTotals([
      store('A', { settledTotal: 1000, settledCount: 3, openTotal: 0, openCount: 0 }),
      store('B', {
        settledTotal: 99999,
        settledCount: 999,
        openTotal: 99999,
        openCount: 999,
        error: 'partial',
      }),
    ]);
    expect(r.settledTotal).toBe(1000);
    expect(r.grandTotal).toBe(1000);
    expect(r.failedStores).toEqual(['B']);
    expect(r.complete).toBe(false);
  });

  it('全店失敗: 合計0・complete=false・全店 failedStores', () => {
    const r = computeMultiStoreDailyTotals([
      store('A', { error: 'e1' }),
      store('B', { error: 'e2' }),
    ]);
    expect(r.grandTotal).toBe(0);
    expect(r.succeededCount).toBe(0);
    expect(r.failedStores).toEqual(['A', 'B']);
    expect(r.anyError).toBe(true);
    expect(r.complete).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // T7: error が空文字列は成功扱い(truthy 判定)
  // ---------------------------------------------------------------------------
  it('error が空文字列/undefined は成功扱い(合算対象)', () => {
    const r = computeMultiStoreDailyTotals([
      store('A', { settledTotal: 100, error: '' }),
      store('B', { settledTotal: 200, error: undefined }),
    ]);
    expect(r.settledTotal).toBe(300);
    expect(r.succeededCount).toBe(2);
    expect(r.complete).toBe(true);
    expect(r.failedStores).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T8: failedStores は順序を保持(行突合の安定性)
  // ---------------------------------------------------------------------------
  it('failedStores は入力順を保持', () => {
    const r = computeMultiStoreDailyTotals([
      store('Z', { error: 'e' }),
      store('A', { settledTotal: 1 }),
      store('M', { error: 'e' }),
    ]);
    expect(r.failedStores).toEqual(['Z', 'M']);
    expect(r.succeededCount).toBe(1);
    expect(r.settledTotal).toBe(1);
  });
});
