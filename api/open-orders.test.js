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
  squareHeaders: vi.fn(() => ({})),
  parseTimeRange: vi.fn(() => ({ beginTimeJST: 'b', endTimeJST: 'e' })),
  fetchCustomers: vi.fn(async () => ({})),
  isValidDateStr: (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s,
  // Phase 2: 展開の既定は「要求 id 単独メンバー・token1・warnings なし」= _2 未設定時と同一挙動。
  resolveSameNameLocationGroup: vi.fn(async (locationId) => ({
    groupName: null,
    members: [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }],
    tokenSummary: [],
    warnings: [],
  })),
}));

const authMod = await import('./_auth.js');
const sharedMod = await import('./_shared.js');
const { default: handler } = await import('./open-orders.js');

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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api/open-orders — 入力検証・越権ガード（既存挙動）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMod.assertLocationAllowed.mockImplementation((ids, id) => Array.isArray(ids) && ids.includes(id));
    sharedMod.resolveSameNameLocationGroup.mockImplementation(async (locationId) => ({
      groupName: null,
      members: [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [],
    }));
    global.fetch = vi.fn(async () => jsonResponse({ orders: [], cursor: undefined }));
  });

  it('必須パラメータ未指定で 400 を返す', async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('不正日付で 400 + invalid_date を返す', async () => {
    const req = makeReq({ date: '2026-02-31', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_date');
  });

  it('許可外 location_id は 200 + 空 orders（resolveSameNameLocationGroup / fetch 未呼び出し）', async () => {
    const req = makeReq({ date: '2026-04-01', location_id: 'OTHER' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ orders: [] });
    expect(sharedMod.resolveSameNameLocationGroup).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('_2 未設定相当（単一メンバー）はバイト同一の 200 + orders（warnings キー非出現）', async () => {
    const req = makeReq({ date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ orders: [] });
    expect('warnings' in res.body).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('api/open-orders — Phase 2 同名グループ展開', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMod.assertLocationAllowed.mockImplementation((ids, id) => Array.isArray(ids) && ids.includes(id));
  });

  it('2 token 展開: concat 後 created_at 降順・customers は各 token のみ取得', async () => {
    sharedMod.resolveSameNameLocationGroup.mockResolvedValue({
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
        return jsonResponse({
          orders: [{ id: 'o_new', created_at: '2026-04-01T10:00:00Z', customer_id: 'c_new', total_money: { amount: 1000 } }],
          cursor: undefined,
        });
      }
      if (locId === 'OLD_ID') {
        return jsonResponse({
          orders: [{ id: 'o_old', created_at: '2026-04-01T09:00:00Z', customer_id: 'c_old', total_money: { amount: 500 } }],
          cursor: undefined,
        });
      }
      throw new Error(`unexpected location_ids: ${locId}`);
    });

    sharedMod.fetchCustomers.mockImplementation(async (customerIds, token) => {
      if (token === 'TOKEN_2' && customerIds.includes('c_new')) return { c_new: '新太郎' };
      if (token === 'TOKEN_1' && customerIds.includes('c_old')) return { c_old: '旧太郎' };
      return {};
    });

    const req = makeReq({ date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.orders[0].id).toBe('o_new'); // 降順先頭
    expect(res.body.orders[1].id).toBe('o_old');
    expect(res.body.orders[0].customer_name).toBe('新太郎');
    expect(res.body.orders[1].customer_name).toBe('旧太郎');
  });

  it('許可外 id へは展開されない（fetch body の location_ids に許可外 id が含まれない）', async () => {
    sharedMod.resolveSameNameLocationGroup.mockImplementation(async (locationId, { allowedLocationIds } = {}) => {
      const full = [
        { id: 'L1', token: 'TOKEN_1', tokenIndex: 1 },
        { id: 'L1_NEW_OTHER_TENANT', token: 'TOKEN_2', tokenIndex: 2 },
      ];
      const members = full.filter((m) => allowedLocationIds.includes(m.id));
      return { groupName: '店', members: members.length ? members : [{ id: locationId, token: 'TOKEN_1', tokenIndex: 1 }], tokenSummary: [], warnings: [] };
    });
    global.fetch = vi.fn(async () => jsonResponse({ orders: [], cursor: undefined }));

    const req = makeReq({ date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(sharedMod.resolveSameNameLocationGroup).toHaveBeenCalledWith('L1', { allowedLocationIds: ['L1'] });
    for (const call of global.fetch.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.location_ids).not.toContain('L1_NEW_OTHER_TENANT');
    }
  });

  it('member の orders 取得失敗は全体エラー（502 + upstream_status・部分金額を返さない）', async () => {
    sharedMod.resolveSameNameLocationGroup.mockResolvedValue({
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
        return new Response('upstream error', { status: 503 });
      }
      return jsonResponse({ orders: [], cursor: undefined });
    });

    const req = makeReq({ date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBe(503);
  });

  it('warnings が非空のとき body に warnings を含める', async () => {
    sharedMod.resolveSameNameLocationGroup.mockResolvedValue({
      groupName: null,
      members: [{ id: 'L1', token: 'TOKEN_1', tokenIndex: 1 }],
      tokenSummary: [],
      warnings: [{ type: 'location_unresolved', location_id: 'L1' }],
    });
    global.fetch = vi.fn(async () => jsonResponse({ orders: [], cursor: undefined }));

    const req = makeReq({ date: '2026-04-01', location_id: 'L1' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.warnings).toEqual([{ type: 'location_unresolved', location_id: 'L1' }]);
  });
});
