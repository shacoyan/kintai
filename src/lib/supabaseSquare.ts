import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

// =============================================================================
// square_dashboard スキーマ専用 Supabase クライアント（schema 固定 / 案b）
// -----------------------------------------------------------------------------
// 設計書 §2.1。kintai の public 用 `supabase` とは別に、db.schema を
// 'square_dashboard' に固定した専用クライアントを新設する。
//   - 同 URL / 同 ANON KEY（VITE_SUPABASE_ANON_KEY を流用。service role は載せない）
//   - `.schema()` の付け忘れ事故を構造的に排除し、public への誤書込を物理防止
//
// ■ GoTrue multiple instance 警告の回避:
//   同一ブラウザで public 用 `supabase` と本クライアントの 2 つが createClient
//   されるため、両者が同じ storageKey でセッションを取り合うと GoTrue が
//   "Multiple GoTrueClient instances detected" を警告する。これを避けるため、
//   本クライアントは認証を一切担当しない（persistSession:false /
//   autoRefreshToken:false）。storageKey も public と分離する。
//
// ■ RLS 到達性（Loop1 完了ゲートでの実検証結果 / 2026-06-06）:
//   anon ロールには square_dashboard schema の USAGE 権限が無い。
//     - anon: has_schema_privilege USAGE=false, locations_meta SELECT=false
//       → anon キー単体の HTTP リクエストは `42501 permission denied for
//         schema square_dashboard`（HTTP 401）で弾かれる（curl 実検証済）。
//     - authenticated: USAGE=true, locations_meta SELECT=true, RLS 有効・
//       qual=true で active 7 行が読める。
//   つまり「anon クライアント単体では読めない」。読むには authenticated の
//   JWT がリクエストに必要。本クライアントは persistSession:false で自前の
//   セッションを持たないため、public 側 `supabase` のセッション（access_token /
//   refresh_token）を setSession() で注入して authenticated JWT を載せる。
//   `ensureSquareSession()` を SELECT 前に呼ぶことでこれを担保する。
//
//   ※ 代替案 a（不採用）: 本ファイルを使わず、既存 public `supabase` に
//     `supabase.schema('square_dashboard')` を都度付けても authenticated JWT が
//     自動で載るため RLS は通る。今回は schema 付け忘れ防止と思想統一のため
//     専用クライアント（案b）＋セッション注入を採用した。anon 直読みが
//     将来 anon GRANT 追加で可能になった場合は ensureSquareSession() を撤去し、
//     注入なしの純 anon クライアントへ単純化できる。
// =============================================================================

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabaseSquare = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'square_dashboard' },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    // public 用クライアントと storageKey を分離（GoTrue multiple instance 警告回避）。
    storageKey: 'kintai_square_auth',
  },
});

/**
 * square_dashboard への SELECT 前に呼ぶ。public 側 `supabase` の現在セッションを
 * 本クライアントへ注入し、authenticated JWT を載せた状態にする（RLS 到達のため）。
 * セッションが無い（未ログイン）場合は何もしない（呼び出し側で空扱い）。
 */
export async function ensureSquareSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;
  await supabaseSquare.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}

/**
 * セッションを注入してから `fn()` を実行する fail-closed ラッパー。
 * (Loop2 申し送り §6.2)
 *
 * `ensureSquareSession()` は未ログイン時に黙って return するため、呼び忘れると
 * 後続の SELECT / RPC が anon 扱いになり越権・誤動作の温床になる。本ラッパーは
 *   1. public 側セッションを取得し、無ければ **即 throw**（fail-closed）。
 *   2. セッションを square クライアントへ注入。
 *   3. `fn()` を実行して結果を返す。
 * これにより「セッション注入忘れ」を構造的に排除する。square_dashboard への
 * SELECT / RPC は本ラッパー経由で呼ぶこと。
 */
export async function withSquareSession<T>(fn: () => Promise<T>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    throw new Error('No active session: cannot access square_dashboard (fail-closed).');
  }
  await supabaseSquare.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return fn();
}
