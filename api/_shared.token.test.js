/**
 * api/_shared.token.test.js
 * kintai 版 Phase 2（デュアルトークン合算）テスト。
 * square-dashboard/api/_shared.token.test.js（Phase 1/2）と同型の観点を kintai の
 * 独立実装（fetchAllLocationsMulti は無フィルタ・squareFetch 経由）に対して固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  squareHeaders,
  getSquareTokens,
  fetchAllLocationsMulti,
  nameGroupKey,
  expandSameNameLocations,
  dedupeLocationsByName,
  resolveSameNameLocationGroup,
} from './_shared.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  delete process.env.SQUARE_ACCESS_TOKEN;
  delete process.env.SQUARE_ACCESS_TOKEN_2;
}

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('squareHeaders (後方互換)', () => {
  it('無引数呼び出し = process.env.SQUARE_ACCESS_TOKEN を使う（現行同一）', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'env-token-1';
    const headers = squareHeaders();
    expect(headers).toEqual({
      Authorization: 'Bearer env-token-1',
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    });
  });

  it('token 引数を渡すとそちらを優先する', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'env-token-1';
    const headers = squareHeaders('explicit-token');
    expect(headers.Authorization).toBe('Bearer explicit-token');
  });
});

describe('getSquareTokens', () => {
  it('SQUARE_ACCESS_TOKEN のみ設定時 → 1件', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    const tokens = getSquareTokens();
    expect(tokens).toEqual([
      { tokenIndex: 1, envKey: 'SQUARE_ACCESS_TOKEN', token: 'tok-1' },
    ]);
  });

  it('SQUARE_ACCESS_TOKEN_2 も設定時 → 2件（順序 1→2）', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    const tokens = getSquareTokens();
    expect(tokens).toEqual([
      { tokenIndex: 1, envKey: 'SQUARE_ACCESS_TOKEN', token: 'tok-1' },
      { tokenIndex: 2, envKey: 'SQUARE_ACCESS_TOKEN_2', token: 'tok-2' },
    ]);
  });

  it('SQUARE_ACCESS_TOKEN_2 が空文字 → 未設定扱い（1件）', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = '';
    expect(getSquareTokens()).toHaveLength(1);
  });

  it('SQUARE_ACCESS_TOKEN_2 が空白のみ → 未設定扱い（1件）', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = '   ';
    expect(getSquareTokens()).toHaveLength(1);
  });

  it('SQUARE_ACCESS_TOKEN_2 === SQUARE_ACCESS_TOKEN（同一値）→ dedupe して1件', () => {
    process.env.SQUARE_ACCESS_TOKEN = 'same-tok';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'same-tok';
    const tokens = getSquareTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ tokenIndex: 1, envKey: 'SQUARE_ACCESS_TOKEN', token: 'same-tok' });
  });

  it('SQUARE_ACCESS_TOKEN すら未設定 → throw', () => {
    expect(() => getSquareTokens()).toThrow();
  });

  it('SQUARE_ACCESS_TOKEN が空白のみ → throw（未設定扱い）', () => {
    process.env.SQUARE_ACCESS_TOKEN = '   ';
    expect(() => getSquareTokens()).toThrow();
  });
});

function makeLocationsResponse(locations) {
  return { ok: true, status: 200, json: async () => ({ locations }), text: async () => '' };
}
function makeErrorResponse(status, body = 'error') {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

describe('fetchAllLocationsMulti（無フィルタ・fail-soft）', () => {
  it('_2 未設定時: fetch は1回のみ・全件返す（フィルタなし）+ _token/_tokenIndex 付与', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    const locs = [
      { id: 'L1', name: '吸暮 本店' },
      { id: 'L2', name: 'Goodbye' },
      { id: 'L3', name: '対象外の店' },
    ];
    const fetchMock = vi.fn(async () => makeLocationsResponse(locs));
    vi.stubGlobal('fetch', fetchMock);

    const { locations, tokenSummary } = await fetchAllLocationsMulti();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(locations.map((l) => l.id)).toEqual(['L1', 'L2', 'L3']);
    expect(locations[0]._token).toBe('tok-1');
    expect(locations[0]._tokenIndex).toBe(1);
    expect(tokenSummary).toEqual([
      { token_index: 1, env_key: 'SQUARE_ACCESS_TOKEN', ok: true, location_count: 3, error: null },
    ]);
  });

  it('2 token 設定時: 両トークンの locations を合算する', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';

    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') {
        return makeLocationsResponse([{ id: 'OLD-L1', name: '吸暮 旧' }]);
      }
      return makeLocationsResponse([{ id: 'NEW-L1', name: '吸暮 新' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { locations, tokenSummary } = await fetchAllLocationsMulti();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(locations.map((l) => l.id)).toEqual(['OLD-L1', 'NEW-L1']);
    expect(locations[0]._tokenIndex).toBe(1);
    expect(locations[1]._tokenIndex).toBe(2);
    expect(tokenSummary).toEqual([
      { token_index: 1, env_key: 'SQUARE_ACCESS_TOKEN', ok: true, location_count: 1, error: null },
      { token_index: 2, env_key: 'SQUARE_ACCESS_TOKEN_2', ok: true, location_count: 1, error: null },
    ]);
  });

  it('同一 location_id が両トークンから返っても dedupe される（token 順で先勝ち）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';

    vi.stubGlobal('fetch', vi.fn(async () => makeLocationsResponse([{ id: 'DUP-L1', name: '吸暮' }])));

    const { locations } = await fetchAllLocationsMulti();
    expect(locations).toHaveLength(1);
    expect(locations[0]._tokenIndex).toBe(1);
  });

  it('片トークン失敗（401） → fail-soft で他方の locations を返す', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';

    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') {
        return makeErrorResponse(401, 'Unauthorized');
      }
      return makeLocationsResponse([{ id: 'NEW-L1', name: '吸暮 新' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { locations, tokenSummary } = await fetchAllLocationsMulti();

    expect(locations.map((l) => l.id)).toEqual(['NEW-L1']);
    expect(tokenSummary[0].ok).toBe(false);
    expect(tokenSummary[0].error).toContain('401');
    expect(tokenSummary[1].ok).toBe(true);
  });

  it('全トークン失敗 → throw（結合エラー全文）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';

    vi.stubGlobal('fetch', vi.fn(async () => makeErrorResponse(500, 'Server Error')));

    await expect(fetchAllLocationsMulti()).rejects.toThrow();
  });

  it('tokenSummary / locations に token 値が漏れない（token_index/env_key のみ）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'secret-tok-1';
    vi.stubGlobal('fetch', vi.fn(async () => makeLocationsResponse([{ id: 'L1', name: '吸暮' }])));

    const { tokenSummary } = await fetchAllLocationsMulti();
    const serialized = JSON.stringify(tokenSummary);
    expect(serialized).not.toContain('secret-tok-1');
    expect(tokenSummary[0]).toHaveProperty('token_index');
    expect(tokenSummary[0]).toHaveProperty('env_key');
  });
});

describe('nameGroupKey', () => {
  it('trim して返す', () => {
    expect(nameGroupKey('  吸暮 ')).toBe('吸暮');
  });
  it('null/undefined は空文字', () => {
    expect(nameGroupKey(null)).toBe('');
    expect(nameGroupKey(undefined)).toBe('');
  });
});

describe('expandSameNameLocations（純関数）', () => {
  const locations = [
    { id: 'OLD', name: '吸暮', _token: 'tok-1', _tokenIndex: 1 },
    { id: 'NEW', name: '吸暮', _token: 'tok-2', _tokenIndex: 2 },
    { id: 'OTHER', name: 'Goodbye', _token: 'tok-1', _tokenIndex: 1 },
  ];

  it('同名グループを tokenIndex 降順 → id 昇順で返す', () => {
    const { groupName, members } = expandSameNameLocations(locations, 'OLD');
    expect(groupName).toBe('吸暮');
    expect(members).toEqual([
      { id: 'NEW', token: 'tok-2', tokenIndex: 2 },
      { id: 'OLD', token: 'tok-1', tokenIndex: 1 },
    ]);
  });

  it('未検出 id → { groupName: null, members: [] }', () => {
    expect(expandSameNameLocations(locations, 'UNKNOWN')).toEqual({ groupName: null, members: [] });
  });

  it('単独店舗は members 1 件', () => {
    const { members } = expandSameNameLocations(locations, 'OTHER');
    expect(members).toEqual([{ id: 'OTHER', token: 'tok-1', tokenIndex: 1 }]);
  });
});

describe('dedupeLocationsByName（純関数）', () => {
  it('代表 = tokenIndex 降順→id 昇順の先頭・出力順 = 初出順', () => {
    const locations = [
      { id: 'OLD-A', name: '吸暮', _tokenIndex: 1 },
      { id: 'OLD-B', name: 'Goodbye', _tokenIndex: 1 },
      { id: 'NEW-A', name: '吸暮', _tokenIndex: 2 },
    ];
    const deduped = dedupeLocationsByName(locations);
    expect(deduped.map((l) => l.id)).toEqual(['NEW-A', 'OLD-B']);
  });

  it('単一トークン時は入力と完全同一（順序・件数・要素）', () => {
    const locations = [
      { id: 'A', name: '吸暮', _tokenIndex: 1 },
      { id: 'B', name: 'Goodbye', _tokenIndex: 1 },
      { id: 'C', name: 'KITUNE', _tokenIndex: 1 },
    ];
    expect(dedupeLocationsByName(locations)).toEqual(locations);
  });
});

describe('resolveSameNameLocationGroup（統合オーケストレータ・never throws）', () => {
  it('_2 未設定・id 解決: members = 要求 id のみ・warnings なし', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    vi.stubGlobal('fetch', vi.fn(async () => makeLocationsResponse([{ id: 'L1', name: '吸暮' }])));

    const result = await resolveSameNameLocationGroup('L1');
    expect(result.members).toEqual([{ id: 'L1', token: 'tok-1', tokenIndex: 1 }]);
    expect(result.warnings).toEqual([]);
  });

  it('2 token・同名 2 id: members に新旧 2 件（tokenIndex 降順）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') return makeLocationsResponse([{ id: 'OLD', name: '吸暮' }]);
      return makeLocationsResponse([{ id: 'NEW', name: '吸暮' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveSameNameLocationGroup('OLD');
    expect(result.members).toEqual([
      { id: 'NEW', token: 'tok-2', tokenIndex: 2 },
      { id: 'OLD', token: 'tok-1', tokenIndex: 1 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('片 token locations 失敗（要求 id は他方に存在）→ 縮退合算 + token_locations_failed warning', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') return makeErrorResponse(401, 'Unauthorized');
      return makeLocationsResponse([{ id: 'NEW', name: '吸暮' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveSameNameLocationGroup('NEW');
    expect(result.members).toEqual([{ id: 'NEW', token: 'tok-2', tokenIndex: 2 }]);
    expect(result.warnings).toEqual([
      { type: 'token_locations_failed', token_index: 1, env_key: 'SQUARE_ACCESS_TOKEN', error: expect.stringContaining('401') },
    ]);
  });

  it('要求 id の属する token が失敗 → 要求 id + token1 フォールバック + location_unresolved', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') return makeLocationsResponse([{ id: 'OLD', name: '吸暮' }]);
      return makeErrorResponse(500, 'Server Error');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveSameNameLocationGroup('NEW');
    expect(result.members).toEqual([{ id: 'NEW', token: 'tok-1', tokenIndex: 1 }]);
    const types = result.warnings.map((w) => w.type);
    expect(types).toContain('token_locations_failed');
    expect(types).toContain('location_unresolved');
  });

  it('全 token locations 失敗 → never throws・要求 id + token1 フォールバック + 両 warning type', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    vi.stubGlobal('fetch', vi.fn(async () => makeErrorResponse(500, 'Server Error')));

    const result = await resolveSameNameLocationGroup('L1');
    expect(result.members).toEqual([{ id: 'L1', token: 'tok-1', tokenIndex: 1 }]);
    const types = result.warnings.map((w) => w.type);
    expect(types).toContain('token_locations_failed');
    expect(types).toContain('location_unresolved');
  });

  it('getSquareTokens が 0 件で throw する場合のみ例外が伝播する', async () => {
    // SQUARE_ACCESS_TOKEN 未設定（resetEnv 済み）。
    await expect(resolveSameNameLocationGroup('L1')).rejects.toThrow();
  });

  it('allowedLocationIds 指定時: members を積集合に限定（フォールバック member も対象）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok-1';
    process.env.SQUARE_ACCESS_TOKEN_2 = 'tok-2';
    const fetchMock = vi.fn(async (url, opts) => {
      const authHeader = opts.headers.Authorization;
      if (authHeader === 'Bearer tok-1') return makeLocationsResponse([{ id: 'OLD', name: '吸暮' }]);
      return makeLocationsResponse([{ id: 'NEW', name: '吸暮' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveSameNameLocationGroup('OLD', { allowedLocationIds: ['OLD'] });
    expect(result.members).toEqual([{ id: 'OLD', token: 'tok-1', tokenIndex: 1 }]);
  });

  it('トークン値がレスポンスに漏れない（JSON.stringify に生 token を含まない）', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 'secret-tok-1';
    vi.stubGlobal('fetch', vi.fn(async () => makeLocationsResponse([{ id: 'L1', name: '吸暮' }])));

    const result = await resolveSameNameLocationGroup('L1');
    const serialized = JSON.stringify({ groupName: result.groupName, tokenSummary: result.tokenSummary, warnings: result.warnings });
    expect(serialized).not.toContain('secret-tok-1');
  });
});
