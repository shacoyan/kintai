import { describe, expect, it } from 'vitest';
import { normalizeLiveSales, normalizeLiveTransactions } from './useSquareLiveSales';

// =============================================================================
// normalize 純関数のユニット（API レスポンス → 表示型変換）。
// React/hook 実行は伴わず、null/欠落/数値文字列の吸収のみを検証する。
// =============================================================================

describe('normalizeLiveSales', () => {
  it('正常系: 数値をそのまま通す', () => {
    expect(normalizeLiveSales({ total_amount: 12345, transaction_count: 8 })).toEqual({
      total_amount: 12345,
      transaction_count: 8,
    });
  });

  it('数値文字列を数値化する', () => {
    expect(normalizeLiveSales({ total_amount: '9800', transaction_count: '3' })).toEqual({
      total_amount: 9800,
      transaction_count: 3,
    });
  });

  it('欠落 / null は 0 化（NaN 伝播ガード）', () => {
    expect(normalizeLiveSales({})).toEqual({ total_amount: 0, transaction_count: 0 });
    expect(normalizeLiveSales({ total_amount: null, transaction_count: undefined })).toEqual({
      total_amount: 0,
      transaction_count: 0,
    });
  });

  it('非数値文字列も 0 化', () => {
    expect(normalizeLiveSales({ total_amount: 'abc', transaction_count: 'x' })).toEqual({
      total_amount: 0,
      transaction_count: 0,
    });
  });

  it('resp が null / 非オブジェクトは null（fail-closed）', () => {
    expect(normalizeLiveSales(null)).toBeNull();
    expect(normalizeLiveSales(undefined)).toBeNull();
    expect(normalizeLiveSales('not-an-object')).toBeNull();
    expect(normalizeLiveSales(42)).toBeNull();
  });
});

describe('normalizeLiveTransactions', () => {
  it('正常系: 1 件を完全な Transaction に整形', () => {
    const result = normalizeLiveTransactions({
      transactions: [
        {
          id: 'tx_1',
          customer_name: '田中',
          created_at_jst: '2026-06-10T13:00:00+09:00',
          order_created_at_jst: '2026-06-10T12:55:00+09:00',
          amount: 1500,
          status: 'COMPLETED',
          source: 'square',
          line_items: [{ name: 'コーヒー', quantity: '2', amount: 1000, category: 'drink' }],
          discounts: [{ name: 'クーポン', amount: 100 }],
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'tx_1',
      customer_name: '田中',
      created_at_jst: '2026-06-10T13:00:00+09:00',
      order_created_at_jst: '2026-06-10T12:55:00+09:00',
      amount: 1500,
      status: 'COMPLETED',
      source: 'square',
      line_items: [{ name: 'コーヒー', quantity: '2', amount: 1000, category: 'drink' }],
      discounts: [{ name: 'クーポン', amount: 100 }],
    });
  });

  it('transactions が無い / 配列でないは空配列（fail-closed）', () => {
    expect(normalizeLiveTransactions(null)).toEqual([]);
    expect(normalizeLiveTransactions({})).toEqual([]);
    expect(normalizeLiveTransactions({ transactions: null })).toEqual([]);
    expect(normalizeLiveTransactions({ transactions: 'x' })).toEqual([]);
  });

  it('欠落フィールド・数値文字列・null を防御的に吸収', () => {
    const result = normalizeLiveTransactions({
      transactions: [
        {
          // id 欠落, customer_name null, amount 文字列, line_items/discounts 欠落
          customer_name: null,
          amount: '2400',
        },
      ],
    });
    expect(result[0]).toEqual({
      id: '',
      customer_name: null,
      created_at_jst: '',
      order_created_at_jst: null,
      amount: 2400,
      status: '',
      source: '',
      line_items: [],
      discounts: [],
    });
  });

  it('line_item の quantity 欠落は "0"、amount 非数値は 0', () => {
    const result = normalizeLiveTransactions({
      transactions: [
        {
          id: 'tx_2',
          line_items: [{ name: 'x', amount: 'NaN' }],
        },
      ],
    });
    expect(result[0].line_items[0]).toEqual({
      name: 'x',
      quantity: '0',
      amount: 0,
      category: null,
    });
  });
});
