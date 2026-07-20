import { describe, it, expect } from 'vitest';
import { uniqueActiveLocationNames } from './useSalesScope';

// =============================================================================
// uniqueActiveLocationNames（Engineer A / 設計書 §6-A D1）
// 2026-07-21 D-01: locations_meta に新旧 Square アカウントの同名 14 行
// （7 店 × 2）が is_active=true で並存するため、location_name を初出順で
// unique 化する純関数のテスト。既存 useSalesByLocation.test.ts の純関数のみを
// 対象とする作法に倣う。
// =============================================================================

describe('uniqueActiveLocationNames', () => {
  it('同名 2 行は 1 件に集約される', () => {
    const rows = [
      { location_name: '吸暮', is_active: true },
      { location_name: '吸暮', is_active: true },
    ];
    expect(uniqueActiveLocationNames(rows)).toEqual(['吸暮']);
  });

  it('初出順を維持する', () => {
    const rows = [
      { location_name: 'Goodbye', is_active: true },
      { location_name: '吸暮', is_active: true },
      { location_name: 'Goodbye', is_active: true },
      { location_name: 'LR', is_active: true },
      { location_name: '吸暮', is_active: true },
    ];
    expect(uniqueActiveLocationNames(rows)).toEqual(['Goodbye', '吸暮', 'LR']);
  });

  it('null・undefined・空文字の name は除外する', () => {
    const rows = [
      { location_name: '吸暮', is_active: true },
      { location_name: '', is_active: true },
      { location_name: null as unknown as string, is_active: true },
      { location_name: undefined as unknown as string, is_active: true },
      { location_name: 'LR', is_active: true },
    ];
    expect(uniqueActiveLocationNames(rows)).toEqual(['吸暮', 'LR']);
  });

  it('全ユニークな入力は恒等（順序・件数とも不変）', () => {
    const rows = [
      { location_name: '吸暮', is_active: true },
      { location_name: 'Goodbye', is_active: true },
      { location_name: '金魚', is_active: true },
      { location_name: 'KITUNE', is_active: true },
      { location_name: 'LR', is_active: true },
      { location_name: 'moumou', is_active: true },
      { location_name: '狛犬', is_active: true },
    ];
    expect(uniqueActiveLocationNames(rows)).toEqual(
      rows.map((r) => r.location_name),
    );
  });

  it('null・undefined 入力は空配列を返す（fail-closed）', () => {
    expect(uniqueActiveLocationNames(null)).toEqual([]);
    expect(uniqueActiveLocationNames(undefined)).toEqual([]);
    expect(uniqueActiveLocationNames([])).toEqual([]);
  });
});
