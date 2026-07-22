import { describe, it, expect, vi, beforeEach } from 'vitest';

// open-orders-range.test.js ハーネス準拠。_auth.js / _shared.js を mock し、fetch を stubGlobal。
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
  normalizePaymentsForReporting: vi.fn((p) => p),
  isValidDateStr: (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s,
  // デフォルト = _2 未設定時と同一（要求 id 自身のみの単一 member）。
  resolveSameNameLocationGroup: vi.fn(async (locationId) => ({
    groupName: null,
    members: [{ id: locationId, token: undefined, tokenIndex: 1 }],
    tokenSummary: [],
    warnings: [],
  })),
}));

const authMod = await import('./_auth.js');
const sharedMod = await import('./_shared.js');
const { default: handler } = await import('./sales.js');

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

/** 非ok 応答（response.text() で errorBody を読む経路に対応）。 */
function nonOkResponse(status) {
  return {
    ok: false,
    status,
    text: async () => `square error body (${status})`,
    json: async () => ({}),
  };
}

/** 正常応答（payments を返し cursor 無しで pagination 終了）。 */
function okPaymentsResponse(payments) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ payments }),
    json: async () => ({ payments, cursor: undefined }),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  authMod.authenticate.mockResolvedValue({
    allowedLocationIds: ['L1'],
    startHourMap: { L1: 11 },
    nameMap: { L1: '店' },
  });
  authMod.assertLocationAllowed.mockImplementation(
    (ids, id) => Array.isArray(ids) && ids.includes(id),
  );
  sharedMod.normalizePaymentsForReporting.mockImplementation((p) => p);
  sharedMod.resolveSameNameLocationGroup.mockReset();
  sharedMod.resolveSameNameLocationGroup.mockImplementation(async (locationId) => ({
    groupName: null,
    members: [{ id: locationId, token: undefined, tokenIndex: 1 }],
    tokenSummary: [],
    warnings: [],
  }));
});

describe('sales.js — 上流 Square 非ok のステータスマッピング', () => {
  it('正常時は 200 で集計を返す（金額不変）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okPaymentsResponse([
          { amount_money: { amount: 1000 } },
          { amount_money: { amount: 500 } },
        ]),
      ),
    );
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total_amount).toBe(1500);
    expect(res.body.transaction_count).toBe(2);
    expect(res.body.currency).toBe('JPY');
  });

  it('上流 Square 401 → 502 + upstream_status:401（認可エラーに見せない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => nonOkResponse(401)));
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBe(401);
  });

  it('上流 Square 403 → 502 + upstream_status:403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => nonOkResponse(403)));
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBe(403);
  });

  it('上流 Square 500 → 502 + upstream_status:500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => nonOkResponse(500)));
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBe(500);
  });

  it('authenticate が AuthError(401) を throw → 401 維持（認可は不変・502 化しない）', async () => {
    authMod.authenticate.mockRejectedValueOnce(new authMod.AuthError('unauthorized', 401));
    vi.stubGlobal('fetch', vi.fn());
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(401);
  });

  it('越権（許可外 location_id）は 200 空データ（存在を漏らさない・不変）', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'OTHER' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ total_amount: 0, transaction_count: 0, currency: 'JPY' });
  });

  it('越権（許可外 location_id）は resolveSameNameLocationGroup / fetch 未呼び出し（展開ロジックに到達しない）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'OTHER' }), res);

    expect(res.statusCode).toBe(200);
    expect(sharedMod.resolveSameNameLocationGroup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sales.js — デュアルトークン合算（設計書§9/§11.3）', () => {
  it('_2 未設定バイト同一: 単一 member（要求 id 自身）で現行と同一レスポンス（warnings キー非出現）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okPaymentsResponse([{ amount_money: { amount: 1000 } }])),
    );
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ total_amount: 1000, transaction_count: 1, currency: 'JPY' });
    expect(res.body.warnings).toBeUndefined();
    expect(sharedMod.resolveSameNameLocationGroup).toHaveBeenCalledWith('L1', { allowedLocationIds: ['L1'] });
  });

  it('2 token 加算: 2 member 分の payments を各自 token で取得し合算する（token 跨ぎ取得なし）', async () => {
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: ['NEW-L1', 'OLD-L1'],
      startHourMap: { 'NEW-L1': 11 },
      nameMap: { 'NEW-L1': '吸暮' },
    });
    sharedMod.resolveSameNameLocationGroup.mockResolvedValueOnce({
      groupName: '吸暮',
      members: [
        { id: 'NEW-L1', token: 'tok-2', tokenIndex: 2 },
        { id: 'OLD-L1', token: 'tok-1', tokenIndex: 1 },
      ],
      tokenSummary: [],
      warnings: [],
    });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('location_id=NEW-L1')) {
        return okPaymentsResponse([{ amount_money: { amount: 1000 } }]);
      }
      if (url.includes('location_id=OLD-L1')) {
        return okPaymentsResponse([{ amount_money: { amount: 500 } }]);
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'NEW-L1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total_amount).toBe(1500);
    expect(res.body.transaction_count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('許可外 id へは展開されない: resolveSameNameLocationGroup へ allowedLocationIds を渡す（積集合限定は _shared 側の責務）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okPaymentsResponse([])));
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: ['L1'],
      startHourMap: { L1: 11 },
      nameMap: { L1: '店' },
    });
    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'L1' }), res);

    expect(res.statusCode).toBe(200);
    expect(sharedMod.resolveSameNameLocationGroup).toHaveBeenCalledWith('L1', { allowedLocationIds: ['L1'] });
  });

  it('member の 1 つが失敗 → 部分合算せず全体 502 + upstream_status（現行踏襲）', async () => {
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: ['NEW-L1', 'OLD-L1'],
      startHourMap: { 'NEW-L1': 11 },
      nameMap: { 'NEW-L1': '吸暮' },
    });
    sharedMod.resolveSameNameLocationGroup.mockResolvedValueOnce({
      groupName: '吸暮',
      members: [
        { id: 'NEW-L1', token: 'tok-2', tokenIndex: 2 },
        { id: 'OLD-L1', token: 'tok-1', tokenIndex: 1 },
      ],
      tokenSummary: [],
      warnings: [],
    });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('location_id=NEW-L1')) {
        return okPaymentsResponse([{ amount_money: { amount: 1000 } }]);
      }
      return nonOkResponse(500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = makeRes();
    await handler(makeReq({ date: '2026-06-10', location_id: 'NEW-L1' }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBe(500);
  });
});
