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
});
