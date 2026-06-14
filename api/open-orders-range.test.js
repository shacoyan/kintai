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

  it('期間 36 日でも 200 を返す (35 日ガード撤廃)', async () => {
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

  it('120 日 (長期間) のリクエストでも 200 を返す (35 日ガード撤廃)', async () => {
    const req = makeReq({
      start_date: '2026-01-01',
      end_date: '2026-04-30',
      location_id: 'L1',
    });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
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
