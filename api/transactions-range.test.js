import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./_shared.js', () => ({
  setCors: vi.fn(() => false),
  parseRangeTimeRange: vi.fn(() => ({ beginTimeJST: 'b', endTimeJST: 'e' })),
  computeBusinessDate: vi.fn(() => '2026-04-01'),
  fetchAllPayments: vi.fn(async () => []),
  fetchOrdersBatch: vi.fn(async () => ({})),
  fetchCatalogVariationCategoryMap: vi.fn(async () => ({})),
  fetchCustomers: vi.fn(async () => ({})),
  normalizePaymentsForReporting: vi.fn((payments) => payments),
  // B7: isValidDateStr/rangeDays/MAX_RANGE_DAYS が _shared.js へ集約されたため実ロジック相当で mock。
  isValidDateStr: (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s,
  rangeDays: (a, b) =>
    Math.floor((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1,
  MAX_RANGE_DAYS: 366,
  // Phase 2: 展開の既定は「要求 id 単独メンバー・token1・warnings なし」= _2 未設定時と同一挙動。
  resolveSameNameLocationGroup: vi.fn(async (locationId) => ({
    groupName: null,
    members: [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }],
    tokenSummary: [],
    warnings: [],
  })),
}));

vi.mock('./_auth.js', () => ({
  authenticate: vi.fn(async () => ({
    allowedLocationIds: ['L1'],
    startHourMap: { L1: 11 },
    nameMap: { L1: '店' },
  })),
  resolveStartHour: vi.fn(() => 11),
  assertLocationAllowed: vi.fn((ids, id) => ids.includes(id)),
  AuthError: class extends Error {
    constructor(m, s) {
      super(m);
      this.status = s;
    }
  },
}));

const { default: handler } = await import('./transactions-range.js');
const { assertLocationAllowed } = await import('./_auth.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function makeReq(query) {
  return { method: 'GET', query, headers: {} };
}

describe('api/transactions-range — 入力検証ガード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertLocationAllowed.mockImplementation((ids, id) => ids.includes(id));
  });

  it('期間 36 日でも 200 を返す (35 日ガード撤廃)', async () => {
    const req = makeReq({
      start_date: '2026-04-01',
      end_date: '2026-05-06', // 36 日
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
  });

  it('期間 35 日でも 200 を返す', async () => {
    const req = makeReq({
      start_date: '2026-04-01',
      end_date: '2026-05-05', // 35 日
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
  });

  it('start_date > end_date で 400 + invalid_date_range を返す', async () => {
    const req = makeReq({
      start_date: '2026-04-30',
      end_date: '2026-04-01',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_date_range');
  });

  it('不正日付 2026-02-31 で 400 + invalid_date を返す', async () => {
    const req = makeReq({
      start_date: '2026-02-31',
      end_date: '2026-03-01',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_date');
  });

  it('日付フォーマット不正 (2026/04/01) で 400 + invalid_date', async () => {
    const req = makeReq({
      start_date: '2026/04/01',
      end_date: '2026/04/05',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_date');
  });

  it('120 日 (長期間) のリクエストでも 200 を返す (35 日ガード撤廃)', async () => {
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2026-04-30',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
  });

  it('必須パラメータ未指定で 400 を返す (既存挙動)', async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/start_date/);
  });

  it('許可外 location_id (越権) で 200 + 空 byDate を返す', async () => {
    const req = makeReq({
      start_date: '2026-04-01',
      end_date: '2026-04-05',
      location_id: 'L_OTHER', // 許可集合 ['L1'] 外
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
  });

  it('366 日 (上限ちょうど・両端含む) は 200 を返す', async () => {
    // 2026-01-01 〜 2027-01-01 = 366 日 (両端含む, MAX_RANGE_DAYS ちょうど)。
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('367 日 (上限超過) で 400 + range_too_large を返す', async () => {
    // 2026-01-01 〜 2027-01-02 = 367 日 (両端含む) > MAX_RANGE_DAYS(366)。
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2027-01-02',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('range_too_large');
  });
});

describe('api/transactions-range — Phase 2 同名グループ展開', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    assertLocationAllowed.mockImplementation((ids, id) => ids.includes(id));
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockImplementation(async (locationId) => ({
      groupName: null,
      members: [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [],
    }));
    shared.fetchAllPayments.mockImplementation(async () => []);
    shared.fetchOrdersBatch.mockImplementation(async () => ({}));
    shared.fetchCustomers.mockImplementation(async () => ({}));
    shared.fetchCatalogVariationCategoryMap.mockImplementation(async () => ({}));
    shared.normalizePaymentsForReporting.mockImplementation((p) => p);
  });

  it('_2 未設定相当（単一メンバー）はバイト同一の 200 + byDate（warnings キー非出現）', async () => {
    const shared = await import('./_shared.js');
    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
    expect('warnings' in res.body).toBe(false);
    expect(shared.fetchAllPayments).toHaveBeenCalledTimes(1);
    expect(shared.fetchAllPayments).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: 'L1', token: 'TOKEN_1' })
    );
  });

  it('2 token 展開: 金額加算・created_at_jst 降順・orders/customers/catalog は各 token のみ取得', async () => {
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockResolvedValue({
      groupName: '店',
      members: [
        { id: 'NEW_ID', token: 'TOKEN_2', tokenIndex: 2 },
        { id: 'OLD_ID', token: 'TOKEN_1', tokenIndex: 1 },
      ],
      tokenSummary: [],
      warnings: [],
    });
    shared.fetchAllPayments.mockImplementation(async ({ location_id, token }) => {
      if (location_id === 'NEW_ID' && token === 'TOKEN_2') {
        return [
          { id: 'p_new', order_id: 'o_new', customer_id: 'c_new', created_at: '2026-04-01T10:00:00Z', amount_money: { amount: 1000 }, status: 'COMPLETED' },
        ];
      }
      if (location_id === 'OLD_ID' && token === 'TOKEN_1') {
        return [
          { id: 'p_old', order_id: 'o_old', customer_id: 'c_old', created_at: '2026-04-01T09:00:00Z', amount_money: { amount: 500 }, status: 'COMPLETED' },
        ];
      }
      throw new Error(`unexpected fetchAllPayments args: ${location_id}/${token}`);
    });
    shared.fetchOrdersBatch.mockImplementation(async (orderIds, token) => {
      if (token === 'TOKEN_2' && orderIds.includes('o_new')) return { o_new: { line_items: [] } };
      if (token === 'TOKEN_1' && orderIds.includes('o_old')) return { o_old: { line_items: [] } };
      return {};
    });
    shared.fetchCustomers.mockImplementation(async (customerIds, token) => {
      if (token === 'TOKEN_2' && customerIds.includes('c_new')) return { c_new: '新太郎' };
      if (token === 'TOKEN_1' && customerIds.includes('c_old')) return { c_old: '旧太郎' };
      return {};
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const txs = res.body.byDate['2026-04-01'].transactions;
    expect(txs).toHaveLength(2);
    // 降順（新しい created_at_jst が先頭）
    expect(txs[0].id).toBe('p_new');
    expect(txs[1].id).toBe('p_old');
    expect(txs[0].customer_name).toBe('新太郎');
    expect(txs[1].customer_name).toBe('旧太郎');
    // 加算確認: 2 payments 分の amount がそれぞれ保持されている（合算はフロント/呼び出し側集計）
    expect(txs.map((t) => t.amount).sort((a, b) => a - b)).toEqual([500, 1000]);
  });

  it('許可外要求 (assertLocationAllowed=false) は resolveSameNameLocationGroup / fetchAllPayments 未呼び出し', async () => {
    const shared = await import('./_shared.js');
    assertLocationAllowed.mockReturnValue(false);
    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'OTHER' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
    expect(shared.resolveSameNameLocationGroup).not.toHaveBeenCalled();
    expect(shared.fetchAllPayments).not.toHaveBeenCalled();
  });

  it('許可外 id へは展開されない（resolveSameNameLocationGroup に allowedLocationIds を渡し積集合限定に委譲）', async () => {
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockImplementation(async (locationId, { allowedLocationIds } = {}) => {
      const full = [
        { id: 'L1', token: 'TOKEN_1', tokenIndex: 1 },
        { id: 'L1_NEW_OTHER_TENANT', token: 'TOKEN_2', tokenIndex: 2 },
      ];
      const members = full.filter((m) => allowedLocationIds.includes(m.id));
      return { groupName: '店', members: members.length ? members : [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }], tokenSummary: [], warnings: [] };
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(shared.resolveSameNameLocationGroup).toHaveBeenCalledWith('L1', { allowedLocationIds: ['L1'] });
    // 許可外 (L1_NEW_OTHER_TENANT) への fetchAllPayments が発生していないこと（URL/引数検証）。
    for (const call of shared.fetchAllPayments.mock.calls) {
      expect(call[0].location_id).not.toBe('L1_NEW_OTHER_TENANT');
    }
  });

  it('member の payments 取得失敗は全体エラー（部分金額を返さない・現行 500 経路を維持）', async () => {
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockResolvedValue({
      groupName: '店',
      members: [
        { id: 'NEW_ID', token: 'TOKEN_2', tokenIndex: 2 },
        { id: 'OLD_ID', token: 'TOKEN_1', tokenIndex: 1 },
      ],
      tokenSummary: [],
      warnings: [],
    });
    shared.fetchAllPayments.mockImplementation(async ({ location_id }) => {
      if (location_id === 'OLD_ID') throw new Error('Square API Error: 500');
      return [{ id: 'p_new', amount_money: { amount: 1000 }, status: 'COMPLETED', created_at: '2026-04-01T10:00:00Z' }];
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('warnings が非空のとき body に warnings を含める', async () => {
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockResolvedValue({
      groupName: null,
      members: [{ id: 'L1', token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [{ type: 'token_locations_failed', token_index: 2, env_key: 'SQUARE_ACCESS_TOKEN_2', error: 'boom' }],
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.warnings).toEqual([{ type: 'token_locations_failed', token_index: 2, env_key: 'SQUARE_ACCESS_TOKEN_2', error: 'boom' }]);
  });
});
