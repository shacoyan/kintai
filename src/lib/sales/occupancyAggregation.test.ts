import { describe, it, expect } from 'vitest';
import type { Transaction } from './types';
import {
  SLOT_COUNT,
  WEEKDAY_COUNT,
  buildOccupancyMatrix,
  getAverages,
  getLineChartData,
  getActiveSlots,
} from './occupancyAggregation';

/**
 * TZ 非依存テスト戦略:
 *   `buildOccupancyMatrix` は入力文字列を `new Date(str)` した後 **ローカルタイム系**
 *   メソッド（getHours/getDay 等）で slot/曜日を確定する。
 *   そこで入力にも「ローカル TZ で意図した日時を組み立てた `new Date(y,mo,d,h,mi)` を
 *   `.toISOString()` した UTC 文字列」を与える。こうすると `new Date(str)` で同一瞬間に戻り、
 *   ローカル解釈で「h 時 → slot=h*2」が実行環境 TZ に関わらず成立する。
 */
function localISO(y: number, mo: number, d: number, h: number, mi = 0): string {
  // mo は 1-12 で受けて Date は 0-11 に変換
  return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();
}

/** 指定セグメント人数を line_items に反映した最小 Transaction を作る */
function makeTx(opts: {
  id?: string;
  start?: string | null; // order_created_at_jst（着座）
  end?: string | null; // created_at_jst（退店/決済）
  newC?: number;
  repeat?: number;
  regular?: number;
  staff?: number;
}): Transaction {
  const line_items = [];
  if (opts.newC) line_items.push({ name: '新規', quantity: String(opts.newC), amount: 0 });
  if (opts.repeat) line_items.push({ name: 'リピート', quantity: String(opts.repeat), amount: 0 });
  if (opts.regular) line_items.push({ name: '常連', quantity: String(opts.regular), amount: 0 });
  if (opts.staff) line_items.push({ name: 'スタッフ', quantity: String(opts.staff), amount: 0 });
  return {
    id: opts.id ?? 'tx',
    customer_name: null,
    created_at_jst: opts.end as string,
    order_created_at_jst: opts.start,
    amount: 0,
    status: 'COMPLETED',
    source: 'square',
    line_items,
    discounts: [],
  } as Transaction;
}

// 2026-06-08 は月曜（toMondayBased=0）。検証用基準日。
const MON = { y: 2026, mo: 6, d: 8 }; // Monday
const MON_WEEKDAY = 0;

describe('getActiveSlots', () => {
  it('(11,23) → [22..47] 26 個', () => {
    const r = getActiveSlots(11, 23);
    expect(r).toEqual(Array.from({ length: 26 }, (_, i) => 22 + i));
    expect(r.length).toBe(26);
  });

  it('(17,2) 翌日跨ぎ → [34..47,0..5] 20 個', () => {
    const r = getActiveSlots(17, 2);
    expect(r).toEqual([34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 0, 1, 2, 3, 4, 5]);
    expect(r.length).toBe(20);
  });

  it('() 引数なし → [0..47] 48 個', () => {
    const r = getActiveSlots();
    expect(r.length).toBe(SLOT_COUNT);
    expect(r[0]).toBe(0);
    expect(r[47]).toBe(47);
  });

  it('(11,10) 翌日跨ぎ全周 → 48 個（11:00〜翌10:59 の 24h）', () => {
    const r = getActiveSlots(11, 10);
    expect(r.length).toBe(48);
    expect(r[0]).toBe(22); // 11:00
    expect(r[47]).toBe(21); // 10:30
  });

  it('(0,23) → 48 個', () => {
    expect(getActiveSlots(0, 23).length).toBe(48);
  });

  it('startHour===endHour → 24h 扱いで 48 個', () => {
    expect(getActiveSlots(11, 11).length).toBe(48);
  });

  it('不正値（NaN/負/24/undefined片方）→ 48 個', () => {
    expect(getActiveSlots(NaN, 23).length).toBe(48);
    expect(getActiveSlots(-1, 23).length).toBe(48);
    expect(getActiveSlots(11, 24).length).toBe(48);
    expect(getActiveSlots(11, undefined).length).toBe(48);
    expect(getActiveSlots(undefined, 10).length).toBe(48);
  });
});

describe('buildOccupancyMatrix', () => {
  it('空入力 → 全 0・skipped 0・totalSpans 0', () => {
    const m = buildOccupancyMatrix([]);
    expect(m.skippedCount).toBe(0);
    expect(m.totalSpans).toBe(0);
    expect(m.sums.groups.length).toBe(WEEKDAY_COUNT);
    expect(m.sums.groups.every((row) => row.length === SLOT_COUNT && row.every((v) => v === 0))).toBe(
      true,
    );
    expect(m.dateCountsPerWeekday).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('単一 tx（同日 1 スロット内・12:00〜12:20）→ groups=1, persons=セグ合計, totalSpans=1', () => {
    // 12:00 → slot 24。12:20 退店も同 slot 24 内。
    const tx = makeTx({
      start: localISO(MON.y, MON.mo, MON.d, 12, 0),
      end: localISO(MON.y, MON.mo, MON.d, 12, 20),
      newC: 2,
      repeat: 1,
      staff: 1,
    });
    const m = buildOccupancyMatrix([tx]);
    expect(m.skippedCount).toBe(0);
    expect(m.totalSpans).toBe(1);
    expect(m.sums.groups[MON_WEEKDAY][24]).toBe(1);
    expect(m.sums.persons[MON_WEEKDAY][24]).toBe(4); // 2+1+0+1
    // 他スロットは 0
    expect(m.sums.groups[MON_WEEKDAY][23]).toBe(0);
    expect(m.sums.groups[MON_WEEKDAY][25]).toBe(0);
    expect(m.dateCountsPerWeekday[MON_WEEKDAY]).toBe(1);
  });

  it('複数スロット跨ぎ（12:00〜13:20）→ slot 24,25,26 全てに計上', () => {
    const tx = makeTx({
      start: localISO(MON.y, MON.mo, MON.d, 12, 0),
      end: localISO(MON.y, MON.mo, MON.d, 13, 20),
      newC: 1,
    });
    const m = buildOccupancyMatrix([tx]);
    expect(m.sums.groups[MON_WEEKDAY][24]).toBe(1); // 12:00
    expect(m.sums.groups[MON_WEEKDAY][25]).toBe(1); // 12:30
    expect(m.sums.groups[MON_WEEKDAY][26]).toBe(1); // 13:00 (13:20 退店, last=13:19→slot26)
    expect(m.sums.groups[MON_WEEKDAY][27]).toBe(0);
  });

  it('order 欠落 → skip・totalSpans 不変', () => {
    const tx = makeTx({ start: null, end: localISO(MON.y, MON.mo, MON.d, 12, 0), newC: 1 });
    const m = buildOccupancyMatrix([tx]);
    expect(m.skippedCount).toBe(1);
    expect(m.totalSpans).toBe(0);
  });

  it('created 欠落 → skip', () => {
    const tx = makeTx({ start: localISO(MON.y, MON.mo, MON.d, 12, 0), end: null, newC: 1 });
    const m = buildOccupancyMatrix([tx]);
    expect(m.skippedCount).toBe(1);
    expect(m.totalSpans).toBe(0);
  });

  it('end<=start → skip', () => {
    const tx = makeTx({
      start: localISO(MON.y, MON.mo, MON.d, 13, 0),
      end: localISO(MON.y, MON.mo, MON.d, 12, 0),
      newC: 1,
    });
    const m = buildOccupancyMatrix([tx]);
    expect(m.skippedCount).toBe(1);
    expect(m.totalSpans).toBe(0);
  });

  it('日跨ぎ tx（月23:30〜火00:30）→ 2 営業日分割・両曜日に計上・dateCounts 両方 +1', () => {
    // 月 2026-06-08 23:30 → 火 2026-06-09 00:30
    const tx = makeTx({
      start: localISO(2026, 6, 8, 23, 30),
      end: localISO(2026, 6, 9, 0, 30),
      newC: 1,
    });
    const m = buildOccupancyMatrix([tx]);
    expect(m.totalSpans).toBe(2); // 2 営業日に分割
    expect(m.sums.groups[0][47]).toBe(1); // 月 23:30 → slot47
    expect(m.sums.groups[1][0]).toBe(1); // 火 00:00 → slot0
    expect(m.dateCountsPerWeekday[0]).toBe(1);
    expect(m.dateCountsPerWeekday[1]).toBe(1);
  });

  it('同曜日 2 営業日でデータ → getAverages が sum/2', () => {
    const tx1 = makeTx({
      id: 'a',
      start: localISO(2026, 6, 8, 12, 0), // 月
      end: localISO(2026, 6, 8, 12, 20),
      newC: 2,
    });
    const tx2 = makeTx({
      id: 'b',
      start: localISO(2026, 6, 15, 12, 0), // 翌週月
      end: localISO(2026, 6, 15, 12, 20),
      newC: 4,
    });
    const m = buildOccupancyMatrix([tx1, tx2]);
    expect(m.dateCountsPerWeekday[MON_WEEKDAY]).toBe(2); // 2 営業日
    expect(m.sums.groups[MON_WEEKDAY][24]).toBe(2); // 2 組
    expect(m.sums.persons[MON_WEEKDAY][24]).toBe(6); // 2+4
    const avg = getAverages(m, MON_WEEKDAY, 24);
    expect(avg.groups).toBe(1); // 2/2
    expect(avg.persons).toBe(3); // 6/2
  });
});

describe('getAverages', () => {
  it('dateCount 0 → 0 除算回避で {groups:0,persons:0}', () => {
    const m = buildOccupancyMatrix([]);
    expect(getAverages(m, 3, 24)).toEqual({ groups: 0, persons: 0 });
  });
});

describe('getLineChartData', () => {
  function fixture() {
    // 月 slot24 に 2 組（persons 6, 2 営業日）
    const tx1 = makeTx({
      id: 'a',
      start: localISO(2026, 6, 8, 12, 0),
      end: localISO(2026, 6, 8, 12, 20),
      newC: 2,
    });
    const tx2 = makeTx({
      id: 'b',
      start: localISO(2026, 6, 15, 12, 0),
      end: localISO(2026, 6, 15, 12, 20),
      newC: 4,
    });
    return buildOccupancyMatrix([tx1, tx2]);
  }
  const allOn = Array.from({ length: WEEKDAY_COUNT }, () => true);

  it("mode='sum' は素の sum", () => {
    const m = fixture();
    const pts = getLineChartData(m, allOn, 'sum', [24]);
    expect(pts).toHaveLength(1);
    expect(pts[0].slot).toBe(24);
    expect(pts[0].groups).toBe(2);
    expect(pts[0].persons).toBe(6);
  });

  it("mode='average' は sum/totalDateCount", () => {
    const m = fixture();
    // 月だけ on にして totalDateCount=2
    const monOnly = Array.from({ length: WEEKDAY_COUNT }, (_, w) => w === MON_WEEKDAY);
    const pts = getLineChartData(m, monOnly, 'average', [24]);
    expect(pts[0].groups).toBe(1); // 2/2
    expect(pts[0].persons).toBe(3); // 6/2
  });

  it('weekdayFilter 全 false → 0', () => {
    const m = fixture();
    const allOff = Array.from({ length: WEEKDAY_COUNT }, () => false);
    const pts = getLineChartData(m, allOff, 'average', [24]);
    expect(pts[0].groups).toBe(0);
    expect(pts[0].persons).toBe(0);
  });

  it('activeSlots 指定でその slot のみ返る', () => {
    const m = fixture();
    const pts = getLineChartData(m, allOn, 'sum', [24, 25]);
    expect(pts.map((p) => p.slot)).toEqual([24, 25]);
  });

  it('activeSlots 未指定で全 48 slot 返る', () => {
    const m = fixture();
    const pts = getLineChartData(m, allOn, 'sum');
    expect(pts).toHaveLength(SLOT_COUNT);
  });
});
