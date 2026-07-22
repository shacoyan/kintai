/**
 * api/locations.test.js
 * kintai locations.js（Phase 2 デュアルトークン name dedupe・設計書§8/§11.3）。
 * _auth.js のみ mock し、_shared.js は実物（fetchAllLocationsMulti / dedupeLocationsByName）を使う。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./_auth.js', () => ({
  authenticate: vi.fn(async () => ({
    allowedLocationIds: ['L1'],
    startHourMap: { L1: 11 },
    nameMap: { L1: '店' },
  })),
  resolveStartHour: vi.fn((map, id) => map?.[id] ?? 11),
  AuthError: class AuthError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'AuthError';
      this.status = status;
    }
  },
}));

const authMod = await import('./_auth.js');
const { default: handler } = await import('./locations.js');

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
    setHeader() {
      return this;
    },
  };
}

function makeReq() {
  return { method: 'GET', query: {}, headers: {} };
}

const STORE_NAMES = ['Goodbye', 'KITUNE', 'LR', 'moumou', '吸暮', '狛犬', '金魚'];
const OLD_LOCS = STORE_NAMES.map((name, i) => ({ id: `OLD-${i}`, name }));
const NEW_LOCS = STORE_NAMES.map((name, i) => ({ id: `NEW-${i}`, name }));

function locationsResponse(locations) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ locations }),
    text: async () => '',
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SQUARE_ACCESS_TOKEN_2;
  process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
});

describe('locations.js — Phase 2 dedupe', () => {
  it('_2 未設定同一: 単一トークン・7件・_token/_tokenIndex 漏洩なし', async () => {
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: OLD_LOCS.map((l) => l.id),
      startHourMap: {},
      nameMap: {},
    });
    vi.stubGlobal('fetch', vi.fn(async () => locationsResponse(OLD_LOCS)));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.locations).toHaveLength(7);
    expect(res.body.warnings).toBeUndefined();
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('_token');
    expect(serialized).not.toContain('_tokenIndex');
    expect(Object.keys(res.body.locations[0]).sort()).toEqual(
      ['business_day_start_hour', 'id', 'name'].sort(),
    );
  });

  it('14→7 dedupe: 代表 = 新アカウント id（tokenIndex 降順）', async () => {
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: [...OLD_LOCS, ...NEW_LOCS].map((l) => l.id),
      startHourMap: {},
      nameMap: {},
    });
    const fetchMock = vi.fn(async (url, opts) => {
      const auth = opts.headers.Authorization;
      if (auth === 'Bearer tok-1') return locationsResponse(OLD_LOCS);
      return locationsResponse(NEW_LOCS);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.locations).toHaveLength(7);
    expect(res.body.locations.every((l) => l.id.startsWith('NEW-'))).toBe(true);
  });

  it('allowedSet filter が dedupe より前: 許可集合が旧 id のみなら新 id は混入しない', async () => {
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: OLD_LOCS.map((l) => l.id), // 旧 id のみ許可
      startHourMap: {},
      nameMap: {},
    });
    const fetchMock = vi.fn(async (url, opts) => {
      const auth = opts.headers.Authorization;
      if (auth === 'Bearer tok-1') return locationsResponse(OLD_LOCS);
      return locationsResponse(NEW_LOCS);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.locations).toHaveLength(7);
    expect(res.body.locations.every((l) => l.id.startsWith('OLD-'))).toBe(true);
  });

  it('出力順 = nameGroupKey 初出順（Square API 返却順を保存）', async () => {
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: OLD_LOCS.map((l) => l.id),
      startHourMap: {},
      nameMap: {},
    });
    vi.stubGlobal('fetch', vi.fn(async () => locationsResponse(OLD_LOCS)));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.locations.map((l) => l.name)).toEqual(STORE_NAMES);
  });

  it('片トークン失敗: fail-soft で解決できた側のみ返し warnings 付与', async () => {
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    authMod.authenticate.mockResolvedValueOnce({
      allowedLocationIds: NEW_LOCS.map((l) => l.id),
      startHourMap: {},
      nameMap: {},
    });
    const fetchMock = vi.fn(async (url, opts) => {
      const auth = opts.headers.Authorization;
      if (auth === 'Bearer tok-1') return { ok: false, status: 401, text: async () => 'Unauthorized', json: async () => ({}) };
      return locationsResponse(NEW_LOCS);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.locations).toHaveLength(7);
    expect(res.body.warnings).toEqual([
      { type: 'token_locations_failed', token_index: 1, env_key: 'SQUARE_ACCESS_TOKEN', error: expect.stringContaining('401') },
    ]);
  });

  it('全トークン失敗: 502（upstream_status 省略・§10 宣言差分2）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'Server Error', json: async () => ({}) })));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.upstream_status).toBeUndefined();
  });

  it('authenticate が AuthError(401) を throw → 401 維持', async () => {
    authMod.authenticate.mockRejectedValueOnce(new authMod.AuthError('unauthorized', 401));
    vi.stubGlobal('fetch', vi.fn());

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(401);
  });
});
