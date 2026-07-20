import { describe, expect, it } from 'vitest';
import { buildAcquisitionByName } from './useSalesAcquisitionAllStores';
import type { StoreAcquisitionSettleInput } from './useSalesAcquisitionAllStores';

// =============================================================================
// useSalesAcquisitionAllStores の純関数ユニット（buildAcquisitionByName）。
// React/hook 実行は伴わない（本リポの hook テスト作法＝純関数のみを対象、
// useSalesByLocation.test.ts 等に倣う）。
// =============================================================================

/** transactions-range 由来の byDate 生形（新規客1件・売上1000）。 */
const TX_RAW = {
  byDate: {
    '2026-07-01': {
      transactions: [
        {
          id: 'tx1',
          customer_name: '新規太郎',
          created_at_jst: '2026-07-01T10:00:00+09:00',
          amount: 1000,
          status: 'COMPLETED',
          source: 'POS',
          line_items: [],
          discounts: [],
        },
      ],
    },
  },
};

/** open-orders-range 由来の byDate 生形（0件）。 */
const OPEN_RAW_EMPTY = { byDate: {} };

function fulfilled(value: unknown): PromiseSettledResult<unknown> {
  return { status: 'fulfilled', value };
}
function rejected(reason: unknown): PromiseSettledResult<unknown> {
  return { status: 'rejected', reason };
}

describe('buildAcquisitionByName', () => {
  it('locationId 未解決の店は fetch 結果を見ずに null + failedStores', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      { name: '未登録店', locationId: '', txResult: null, openResult: null },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(byName['未登録店']).toBeNull();
    expect(failedStores).toEqual(['未登録店']);
  });

  it('tx/open 両方成功: aggregateSegments で集計される', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      {
        name: 'A店',
        locationId: 'LOC_A',
        txResult: fulfilled(TX_RAW),
        openResult: fulfilled(OPEN_RAW_EMPTY),
      },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(failedStores).toEqual([]);
    expect(byName['A店']).not.toBeNull();
    // 集計元 line_items が空のため acquisition は unknown 側に落ちる可能性があるが、
    // ここでは「null でない = 成功として集計された」ことのみを確認する。
    expect(typeof byName['A店']?.unknown).toBe('number');
  });

  it('tx 成功 / open 失敗（片側成功）: 成功側だけで集計され失敗店扱いにならない', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      {
        name: 'B店',
        locationId: 'LOC_B',
        txResult: fulfilled(TX_RAW),
        openResult: rejected(new Error('open failed')),
      },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(failedStores).toEqual([]);
    expect(byName['B店']).not.toBeNull();
  });

  it('tx 失敗 / open 成功（片側成功）: 成功側だけで集計され失敗店扱いにならない', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      {
        name: 'C店',
        locationId: 'LOC_C',
        txResult: rejected(new Error('tx failed')),
        openResult: fulfilled(OPEN_RAW_EMPTY),
      },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(failedStores).toEqual([]);
    expect(byName['C店']).not.toBeNull();
  });

  it('tx/open 両方失敗: null + failedStores', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      {
        name: 'D店',
        locationId: 'LOC_D',
        txResult: rejected(new Error('tx failed')),
        openResult: rejected(new Error('open failed')),
      },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(byName['D店']).toBeNull();
    expect(failedStores).toEqual(['D店']);
  });

  it('複数店混在: 成功・失敗・未解決が独立に処理される（1店の失敗が他店を巻き込まない）', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      {
        name: '成功店',
        locationId: 'LOC_OK',
        txResult: fulfilled(TX_RAW),
        openResult: fulfilled(OPEN_RAW_EMPTY),
      },
      {
        name: '失敗店',
        locationId: 'LOC_NG',
        txResult: rejected(new Error('tx failed')),
        openResult: rejected(new Error('open failed')),
      },
      { name: '未解決店', locationId: '', txResult: null, openResult: null },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(byName['成功店']).not.toBeNull();
    expect(byName['失敗店']).toBeNull();
    expect(byName['未解決店']).toBeNull();
    expect(failedStores.sort()).toEqual(['失敗店', '未解決店'].sort());
  });

  it('txResult/openResult が null（渡し忘れ相当）でも失敗扱いになる（fail-soft）', () => {
    const inputs: StoreAcquisitionSettleInput[] = [
      { name: 'E店', locationId: 'LOC_E', txResult: null, openResult: null },
    ];
    const { byName, failedStores } = buildAcquisitionByName(inputs);
    expect(byName['E店']).toBeNull();
    expect(failedStores).toEqual(['E店']);
  });
});
