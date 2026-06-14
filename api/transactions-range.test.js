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
