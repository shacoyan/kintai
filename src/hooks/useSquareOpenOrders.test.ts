import { describe, expect, it } from 'vitest';
import { normalizeOpenOrders } from './useSquareOpenOrders';

// =============================================================================
// normalizeOpenOrders 純関数のユニット（/api/open-orders レスポンス → OpenOrder[]）。
// React/hook 実行は伴わず、null/欠落/数値文字列の吸収のみを検証する。
// =============================================================================

describe('normalizeOpenOrders', () => {
  it('正常系: 数値・配列をそのまま通す', () => {
    expect(
      normalizeOpenOrders({
        orders: [
          {
            id: 'o1',
            created_at: '2026-06-10T12:00:00+09:00',
            total_money: 3200,
            customer_name: '田中',
            line_items: [
              { name: 'シーシャ', quantity: '2', amount: 3000, category: 'drink' },
            ],
            discounts: [{ name: 'クーポン', amount: 200 }],
          },
        ],
      }),
    ).toEqual([
      {
        id: 'o1',
        created_at: '2026-06-10T12:00:00+09:00',
        total_money: 3200,
        customer_name: '田中',
        line_items: [
          { name: 'シーシャ', quantity: '2', amount: 3000, category: 'drink' },
        ],
        discounts: [{ name: 'クーポン', amount: 200 }],
      },
    ]);
  });

  it('数値文字列を数値化する（total_money / amount）', () => {
    const [o] = normalizeOpenOrders({
      orders: [{ id: 'x', total_money: '9800', line_items: [{ name: 'a', quantity: '1', amount: '500' }] }],
    });
    expect(o.total_money).toBe(9800);
    expect(o.line_items[0].amount).toBe(500);
  });

  it('欠落 / null フィールドを安全な既定に倒す（NaN 伝播ガード）', () => {
    const [o] = normalizeOpenOrders({ orders: [{}] });
    expect(o).toEqual({
      id: '',
      created_at: null,
      total_money: 0,
      customer_name: null,
      line_items: [],
      discounts: [],
    });
  });

  it('非数値 total_money は 0 化', () => {
    const [o] = normalizeOpenOrders({ orders: [{ id: 'a', total_money: 'abc' }] });
    expect(o.total_money).toBe(0);
  });

  it('quantity 欠落は "0" 文字列に倒す', () => {
    const [o] = normalizeOpenOrders({
      orders: [{ id: 'a', line_items: [{ name: 'x' }] }],
    });
    expect(o.line_items[0].quantity).toBe('0');
  });

  it('orders が配列でなければ空配列（fail-closed）', () => {
    expect(normalizeOpenOrders({ orders: null })).toEqual([]);
    expect(normalizeOpenOrders({})).toEqual([]);
    expect(normalizeOpenOrders(null)).toEqual([]);
    expect(normalizeOpenOrders('nope')).toEqual([]);
  });
});
