import { supabase } from '../supabase';

// =============================================================================
// squareLiveClient — kintai 版の薄い fetch + Bearer ラッパ（Wave4-P1 §4.3.1）
// -----------------------------------------------------------------------------
// 見本（square-dashboard）の hooks は `token` prop を受け取り Bearer に載せるが、
// kintai は public 側 supabase セッションの access_token を都度取得して載せる。
// これが「見本 hooks の kintai 版（withSquareSession でなく fetch+Bearer）」の実体。
//
// 設計判断（設計書 §4.3.1 / §7 R7）:
//   - セッションは `supabase.auth.getSession()` で都度取得する（自動 refresh 済の
//     最新 JWT が得られる）。セッション無し / access_token 欠落は即 throw（fail-closed・
//     既存 `withSquareSession` と同思想）。401 はタブ放置による JWT 失効を想定し、
//     再ログインを促す文言にする。
//   - !res.ok のエラーは HTTP ステータス全文を含めて throw（短縮しない＝MEMORY ルール）。
//   - タイムアウトは AbortController で打ち切り、明示的なエラー文言にする。
// =============================================================================

/** fetch のタイムアウト（ミリ秒）。catalog 2 段 fetch が重い API もあるため余裕を持たせる。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** セッション無し / JWT 失効時の再ログイン誘導文言。 */
const NO_SESSION_MESSAGE =
  'ログインセッションが見つかりません。再度ログインしてください。';
const EXPIRED_SESSION_MESSAGE =
  'ログインセッションの有効期限が切れました。再度ログインしてください。 (HTTP 401)';

export interface SquareFetchOptions {
  /** タイムアウト（ミリ秒）。省略時 30s。 */
  timeoutMs?: number;
  /** 外部 AbortSignal（任意）。タイムアウトとは別に呼び出し側からも中断できる。 */
  signal?: AbortSignal;
}

/**
 * public 側 supabase セッションの access_token を Bearer に載せて `/api/...` を叩く。
 *
 *   - セッション無し / access_token 欠落 → throw（fail-closed）。
 *   - !res.ok → throw（HTTP ステータス全文。401 は再ログイン誘導）。
 *   - タイムアウト → throw（明示文言）。
 *   - 成功時は res.json() を `T` として返す。
 *
 * @throws Error fail-closed / HTTP エラー / タイムアウト時。
 */
export async function squareFetch<T>(
  path: string,
  options: SquareFetchOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal } = options;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    // セッション取得自体が失敗（fail-closed）。原因全文を残す。
    throw new Error(`セッションの取得に失敗しました: ${error.message}`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error(NO_SESSION_MESSAGE);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 外部 signal が中断したら内部 controller も中断させる。
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await fetch(path, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401) {
        // タブ放置などで JWT 失効 → 再ログイン誘導（§7 R7）。
        throw new Error(EXPIRED_SESSION_MESSAGE);
      }
      // ステータス全文を残す（短縮禁止＝MEMORY ルール）。
      throw new Error(`リクエストに失敗しました (HTTP ${res.status})`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 外部 signal による中断はそのまま伝播させ、タイムアウトは明示文言にする。
      if (externalSignal?.aborted) throw err;
      throw new Error(`リクエストがタイムアウトしました (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
