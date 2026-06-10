import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// supabase.auth.getSession をモック化（public セッションの access_token 注入を検証）。
// ---------------------------------------------------------------------------
const getSessionMock = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
    },
  },
}));

import { squareFetch } from './squareLiveClient';

function sessionWith(token: string | null) {
  return {
    data: { session: token === null ? null : { access_token: token } },
    error: null,
  };
}

describe('squareFetch', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('セッションの access_token を Bearer に載せて fetch し、json を返す', async () => {
    getSessionMock.mockResolvedValue(sessionWith('jwt-abc'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ total_amount: 1000 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await squareFetch<{ total_amount: number }>('/api/sales?date=2026-06-10');

    expect(result).toEqual({ total_amount: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sales?date=2026-06-10');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
  });

  it('セッション無し（access_token 欠落）は fail-closed で throw（fetch しない）', async () => {
    getSessionMock.mockResolvedValue(sessionWith(null));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(squareFetch('/api/sales')).rejects.toThrow(/再度ログイン/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSession 自体のエラーは原因全文を載せて throw', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: { message: 'network down' } });
    vi.stubGlobal('fetch', vi.fn());

    await expect(squareFetch('/api/sales')).rejects.toThrow(/network down/);
  });

  it('401 は再ログイン誘導文言（HTTP 401 を含む）で throw', async () => {
    getSessionMock.mockResolvedValue(sessionWith('jwt-abc'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(squareFetch('/api/sales')).rejects.toThrow(/HTTP 401/);
    await expect(squareFetch('/api/sales')).rejects.toThrow(/再度ログイン/);
  });

  it('!res.ok（500）は HTTP ステータス全文を載せて throw（短縮しない）', async () => {
    getSessionMock.mockResolvedValue(sessionWith('jwt-abc'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    await expect(squareFetch('/api/sales')).rejects.toThrow(/HTTP 500/);
  });

  it('タイムアウトは明示文言で throw', async () => {
    getSessionMock.mockResolvedValue(sessionWith('jwt-abc'));
    // fetch が AbortError を投げる（AbortController.abort 相当）。
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () => Promise.reject(new DOMException('aborted', 'AbortError')),
      ),
    );

    await expect(squareFetch('/api/sales', { timeoutMs: 5 })).rejects.toThrow(/タイムアウト/);
  });
});
