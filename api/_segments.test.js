import { describe, it, expect } from 'vitest';
import * as Ts from '../src/lib/sales/customerSegment';
import * as Js from './_segments.js';

/**
 * TS 版 (src/lib/customerSegment.ts) と JS 版 (api/_segments.js) が
 * 同一 fixture に対して同一結果を返すことを担保する整合テスト。
 * cron / バックフィルが TS と乖離すると後段 KPI が壊れるため必須。
 */

// fx1: 新規 2 + リピート 1, amount=3000 (端数寄せ先=count 最大の new)
const fx1 = {
  id: 't1',
  customer_name: null,
  created_at_jst: '2026-05-20T12:00:00+09:00',
  amount: 3000,
  status: 'COMPLETED',
  source: 'square',
  line_items: [
    { name: '新規', quantity: '2' },
    { name: 'リピート', quantity: '1' },
  ],
  discounts: [],
};

// fx2: 常連 3 + スタッフ 1, amount=5000 (端数寄せ先=常連)
const fx2 = {
  id: 't2',
  customer_name: null,
  created_at_jst: '2026-05-20T13:00:00+09:00',
  amount: 5000,
  status: 'COMPLETED',
  source: 'square',
  line_items: [
    { name: '常連', quantity: '3' },
    { name: 'スタッフ', quantity: '1' },
  ],
  discounts: [],
};

// fx3: 該当キーワード一切無し → unlisted=1, sales 全部 unlisted
const fx3 = {
  id: 't3',
  customer_name: null,
  created_at_jst: '2026-05-20T14:00:00+09:00',
  amount: 4000,
  status: 'COMPLETED',
  source: 'square',
  line_items: [{ name: '特別サービス', quantity: '1' }],
  discounts: [],
};

// fx4: 新規 2 (Google) + 新規 1 (口コミ) → acquisition channelTotal=3, unknown=0
const fx4 = {
  id: 't4',
  customer_name: null,
  created_at_jst: '2026-05-20T15:00:00+09:00',
  amount: 4000,
  status: 'COMPLETED',
  source: 'square',
  line_items: [
    { name: '新規（Google）', quantity: '2' },
    { name: '新規（口コミ）', quantity: '1' },
  ],
  discounts: [],
};

// fx5: 新規 5 (チャネル無し) → acquisition.unknown=5
const fx5 = {
  id: 't5',
  customer_name: null,
  created_at_jst: '2026-05-20T16:00:00+09:00',
  amount: 5000,
  status: 'COMPLETED',
  source: 'square',
  line_items: [{ name: '新規', quantity: '5' }],
  discounts: [],
};

// fx6: 端数タイブレーク。新規=1, リピート=1, regular=0, staff=0, amount=1001
// → priority reduce 結果は最初のキー 'new' に寄せ
const fx6 = {
  id: 't6',
  customer_name: null,
  created_at_jst: '2026-05-20T17:00:00+09:00',
  amount: 1001,
  status: 'COMPLETED',
  source: 'square',
  line_items: [
    { name: '新規', quantity: '1' },
    { name: 'リピート', quantity: '1' },
  ],
  discounts: [],
};

const fixtures = [fx1, fx2, fx3, fx4, fx5, fx6];

describe('TS/JS Equivalence — customerSegment.ts <-> _segments.js', () => {
  it('countCustomersByTransaction returns identical results for all fixtures', () => {
    for (const fx of fixtures) {
      expect(Js.countCustomersByTransaction(fx)).toEqual(Ts.countCustomersByTransaction(fx));
    }
  });

  it('allocateSalesByTransaction returns identical results for all fixtures', () => {
    for (const fx of fixtures) {
      expect(Js.allocateSalesByTransaction(fx)).toEqual(Ts.allocateSalesByTransaction(fx));
    }
  });

  it('detectAcquisitionChannels returns identical results for all fixtures', () => {
    for (const fx of fixtures) {
      expect(Js.detectAcquisitionChannels(fx)).toEqual(Ts.detectAcquisitionChannels(fx));
    }
  });

  it('aggregateSegments returns identical results for the entire fixtures array', () => {
    expect(Js.aggregateSegments(fixtures)).toEqual(Ts.aggregateSegments(fixtures));
  });

  it('fx6 (1001 amount, new=1, repeat=1) — 端数寄せ先=new (タイブレーク priority)', () => {
    const result = Js.allocateSalesByTransaction(fx6);
    expect(result.new + result.repeat + result.regular + result.staff + result.unlisted).toBe(1001);
    expect(result.new).toBeGreaterThanOrEqual(result.repeat);
  });

  it('fx2 (5000 amount, regular=3, staff=1) — 端数寄せ先=regular', () => {
    const result = Js.allocateSalesByTransaction(fx2);
    expect(result.new + result.repeat + result.regular + result.staff + result.unlisted).toBe(5000);
    expect(result.regular).toBe(5000 - result.staff);
  });
});
