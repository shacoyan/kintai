import { describe, it, expect } from 'vitest';
import { computeSegmentBreakdown } from './SegmentBreakdownList';
import type { SegmentBreakdown } from '../../lib/sales/types';

describe('computeSegmentBreakdown (B24)', () => {
  it('正の値で構成%を positiveTotal 分母で算出する', () => {
    const sales: SegmentBreakdown = {
      new: 100,
      repeat: 100,
      regular: 100,
      staff: 100,
      unlisted: 0,
    };
    const result = computeSegmentBreakdown(sales);
    // 合計 400 → 各 100 は 25%、unlisted は 0%
    expect(result.find((r) => r.segment === 'new')!.share).toBeCloseTo(25, 5);
    expect(result.find((r) => r.segment === 'unlisted')!.share).toBeCloseTo(0, 5);
    expect(result.map((r) => r.amount)).toEqual([100, 100, 100, 100, 0]);
  });

  it('全 5 セグメントを SEGMENT_ORDER 順で返す', () => {
    const sales: SegmentBreakdown = { new: 1, repeat: 2, regular: 3, staff: 4, unlisted: 5 };
    const result = computeSegmentBreakdown(sales);
    expect(result.map((r) => r.segment)).toEqual([
      'new',
      'repeat',
      'regular',
      'staff',
      'unlisted',
    ]);
  });

  it('負スライスは 0 クランプして分母に含めない（positiveTotal 整合）', () => {
    const sales: SegmentBreakdown = {
      new: 100,
      repeat: -50, // 返金等で負 → 分母にもシェアにも寄与しない
      regular: 0,
      staff: 0,
      unlisted: 0,
    };
    const result = computeSegmentBreakdown(sales);
    // positiveTotal = 100 のみ → new=100%、repeat の share は 0（amount は負のまま保持）
    expect(result.find((r) => r.segment === 'new')!.share).toBeCloseTo(100, 5);
    const repeat = result.find((r) => r.segment === 'repeat')!;
    expect(repeat.share).toBeCloseTo(0, 5);
    expect(repeat.amount).toBe(-50);
  });

  it('Σ<=0（全 0）のとき share=null（% 非表示・NaN/Infinity を出さない）', () => {
    const sales: SegmentBreakdown = { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0 };
    const result = computeSegmentBreakdown(sales);
    for (const r of result) {
      expect(r.share).toBeNull();
    }
  });

  it('Σ<=0（全 負）のとき share=null', () => {
    const sales: SegmentBreakdown = {
      new: -10,
      repeat: -20,
      regular: -5,
      staff: -1,
      unlisted: -3,
    };
    const result = computeSegmentBreakdown(sales);
    for (const r of result) {
      expect(r.share).toBeNull();
    }
  });
});
