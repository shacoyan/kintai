import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_MAX_RANGE_DAYS,
  clampAcquisitionRange,
  flattenTxRange,
  flattenOpenRange,
} from './useSalesAcquisitionLive';

// =============================================================================
// useSalesAcquisitionLive の純関数ユニット（クランプ / byDate flatten / 正規化）。
// React/hook 実行は伴わない。
// =============================================================================

describe('clampAcquisitionRange', () => {
  it('92 日以内はクランプしない（そのまま返す）', () => {
    // 2026-04-01 〜 2026-04-30 = 29 日差。
    expect(clampAcquisitionRange('2026-04-01', '2026-04-30')).toEqual({
      start: '2026-04-01',
      end: '2026-04-30',
      clamped: false,
    });
  });

  it('ちょうど 92 日差はクランプしない（境界）', () => {
    // 2026-01-01 + 92 日 = 2026-04-03。
    const r = clampAcquisitionRange('2026-01-01', '2026-04-03');
    expect(r.clamped).toBe(false);
    expect(r.start).toBe('2026-01-01');
  });

  it('92 日超は startDate を endDate-92 日にクランプ（year 相当）', () => {
    // 2025-06-10 〜 2026-06-10（365 日）→ start を 2026-06-10 の 92 日前へ。
    const r = clampAcquisitionRange('2025-06-10', '2026-06-10');
    expect(r.clamped).toBe(true);
    expect(r.end).toBe('2026-06-10');
    expect(r.start).toBe('2026-03-10'); // 2026-06-10 − 92 日
  });

  it('maxDays を明示指定できる', () => {
    const r = clampAcquisitionRange('2026-01-01', '2026-12-31', 30);
    expect(r.clamped).toBe(true);
    expect(r.end).toBe('2026-12-31');
    expect(r.start).toBe('2026-12-01'); // 12-31 − 30 日
  });

  it('既定 maxDays は ACQUISITION_MAX_RANGE_DAYS (92)', () => {
    expect(ACQUISITION_MAX_RANGE_DAYS).toBe(92);
  });

  it('end < start の逆転入力はクランプせずそのまま返す（fail-soft）', () => {
    expect(clampAcquisitionRange('2026-06-10', '2026-01-01')).toEqual({
      start: '2026-06-10',
      end: '2026-01-01',
      clamped: false,
    });
  });
});

describe('flattenTxRange', () => {
  it('byDate の transactions を flat 化し最小正規化する', () => {
    const txs = flattenTxRange({
      byDate: {
        '2026-06-01': {
          transactions: [
            {
              id: 't1',
              amount: '1000',
              line_items: [{ name: '新規Google', quantity: '1', amount: 0 }],
            },
          ],
        },
        '2026-06-02': {
          transactions: [{ id: 't2', amount: 500, line_items: [] }],
        },
      },
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].id).toBe('t1');
    expect(txs[0].amount).toBe(1000); // 数値文字列 → number
    expect(txs[0].line_items[0].name).toBe('新規Google');
  });

  it('byDate 非オブジェクト / 欠落は空配列（fail-soft）', () => {
    expect(flattenTxRange({})).toEqual([]);
    expect(flattenTxRange({ byDate: null })).toEqual([]);
    expect(flattenTxRange(null)).toEqual([]);
  });
});

describe('flattenOpenRange', () => {
  it('byDate の orders を OPEN な Transaction に変換する（openOrderToTransaction 同型）', () => {
    const txs = flattenOpenRange({
      byDate: {
        '2026-06-01': {
          orders: [
            {
              id: 'o1',
              created_at: '2026-06-01T12:00:00+09:00',
              total_money: '2400',
              customer_name: '佐藤',
              line_items: [{ name: '新規SNS', quantity: '1', amount: 0 }],
            },
          ],
        },
      },
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].status).toBe('OPEN');
    expect(txs[0].source).toBe('OPEN_TICKET');
    expect(txs[0].amount).toBe(2400); // total_money → amount
    expect(txs[0].created_at_jst).toBe('2026-06-01T12:00:00+09:00');
    expect(txs[0].line_items[0].name).toBe('新規SNS');
  });

  it('byDate 非オブジェクト / 欠落は空配列（fail-soft）', () => {
    expect(flattenOpenRange({})).toEqual([]);
    expect(flattenOpenRange(null)).toEqual([]);
  });
});
