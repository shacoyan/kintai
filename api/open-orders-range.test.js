import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./_auth.js', () => ({
  authenticate: vi.fn(async () => ({
    allowedLocationIds: ['L1'],
    startHourMap: { L1: 11 },
    nameMap: { L1: '店' },
  })),
  resolveStartHour: vi.fn(() => 11),
  assertLocationAllowed: vi.fn((ids, id) => Array.isArray(ids) && ids.includes(id)),
  AuthError: class AuthError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'AuthError';
      this.status = status;
    }
  },
}));

vi.mock('./_shared.js', () => ({
  setCors: vi.fn(() => false),
  parseRangeTimeRange: vi.fn(() => ({ beginTimeJST: 'b', endTimeJST: 'e' })),
  computeBusinessDate: vi.fn(() => '2026-04-01'),
  fetchCustomers: vi.fn(async () => ({})),
  squareHeaders: vi.fn(() => ({})),
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

// 35 日ガード撤廃済み (2026-05-21) → どの期間でも fetch が呼ばれる前提。
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ orders: [], cursor: undefined }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

const authMod = await import('./_auth.js');
const { default: handler } = await import('./open-orders-range.js');

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

describe('api/open-orders-range — 入力検証ガード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMod.assertLocationAllowed.mockImplementation((ids, id) => Array.isArray(ids) && ids.includes(id));
  });

  it('期間 36 日でも 200 を返す (35 日ガードは撤廃済・open-orders 業務上限 92 日内)', async () => {
    const req = makeReq({
      start_date: '2026-04-01',
      end_date: '2026-05-06',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
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

  it('92 日 (open-orders 業務上限ちょうど・両端含む) は 200 を返す', async () => {
    // 2026-01-01 〜 2026-04-02 = 92 日 (両端含む, OPEN_ORDERS_MAX_DAYS ちょうど)。
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2026-04-02',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('93 日 (open-orders 業務上限超過) で 400 + range_too_large を返す', async () => {
    // 2026-01-01 〜 2026-04-03 = 93 日 (両端含む) > OPEN_ORDERS_MAX_DAYS(92)。
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2026-04-03',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('range_too_large');
  });

  it('必須パラメータ未指定で 400 を返す (既存挙動)', async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/location_id/);
  });

  it('許可外 location は越権封鎖で 200 + 空 byDate を返す', async () => {
    authMod.assertLocationAllowed.mockReturnValue(false);
    const req = makeReq({
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      location_id: 'OTHER',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
  });
});

describe('api/open-orders-range — Phase 2 同名グループ展開', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    authMod.assertLocationAllowed.mockImplementation((ids, id) => Array.isArray(ids) && ids.includes(id));
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockImplementation(async (locationId) => ({
      groupName: null,
      members: [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [],
    }));
    shared.fetchCustomers.mockImplementation(async () => ({}));
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ orders: [], cursor: undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('_2 未設定相当（単一メンバー）はバイト同一の 200 + byDate（warnings キー非出現）', async () => {
    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
    expect('warnings' in res.body).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('2 token 展開: concat 後 created_at 降順で byDate グループ化・customers は各 token のみ取得', async () => {
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
    global.fetch = vi.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      const locId = body.location_ids[0];
      if (locId === 'NEW_ID') {
        return new Response(JSON.stringify({
          orders: [{ id: 'o_new', created_at: '2026-04-01T10:00:00Z', customer_id: 'c_new', total_money: { amount: 1000 } }],
          cursor: undefined,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (locId === 'OLD_ID') {
        return new Response(JSON.stringify({
          orders: [{ id: 'o_old', created_at: '2026-04-01T09:00:00Z', customer_id: 'c_old', total_money: { amount: 500 } }],
          cursor: undefined,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected location_ids: ${locId}`);
    });
    shared.fetchCustomers.mockImplementation(async (customerIds, token) => {
      if (token === 'TOKEN_2' && customerIds.includes('c_new')) return { c_new: '新太郎' };
      if (token === 'TOKEN_1' && customerIds.includes('c_old')) return { c_old: '旧太郎' };
      return {};
    });
    shared.computeBusinessDate.mockReturnValue('2026-04-01');

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const orders = res.body.byDate['2026-04-01'].orders;
    expect(orders).toHaveLength(2);
    expect(orders[0].id).toBe('o_new'); // 降順先頭
    expect(orders[1].id).toBe('o_old');
    expect(orders[0].customer_name).toBe('新太郎');
    expect(orders[1].customer_name).toBe('旧太郎');
  });

  it('許可外要求 (assertLocationAllowed=false) は resolveSameNameLocationGroup / fetch 未呼び出し', async () => {
    const shared = await import('./_shared.js');
    authMod.assertLocationAllowed.mockReturnValue(false);
    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'OTHER' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ byDate: {} });
    expect(shared.resolveSameNameLocationGroup).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('許可外 id へは展開されない（fetch body の location_ids に許可外 id が含まれない）', async () => {
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
    for (const call of global.fetch.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.location_ids).not.toContain('L1_NEW_OTHER_TENANT');
    }
  });

  it('member の orders 取得失敗は全体エラー（502・部分金額を返さない）', async () => {
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
    global.fetch = vi.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.location_ids[0] === 'OLD_ID') {
        return new Response('upstream error', { status: 500 });
      }
      return new Response(JSON.stringify({ orders: [], cursor: undefined }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('Square API error');
  });

  it('warnings が非空のとき body に warnings を含める', async () => {
    const shared = await import('./_shared.js');
    shared.resolveSameNameLocationGroup.mockResolvedValue({
      groupName: null,
      members: [{ id: 'L1', token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [{ type: 'location_unresolved', location_id: 'L1' }],
    });

    const req = makeReq({ start_date: '2026-04-01', end_date: '2026-04-05', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.warnings).toEqual([{ type: 'location_unresolved', location_id: 'L1' }]);
  });
});
