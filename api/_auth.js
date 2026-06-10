/**
 * api/_auth.js
 * Wave4 認可の単一情報源（kintai 専用・新規）。
 *
 * 役割:
 *   - リクエストの `Authorization: Bearer <ユーザー JWT>` を検証。
 *   - anon key + global.headers に JWT を載せた supabase-js クライアントで
 *     `square_dashboard.get_allowed_location_ids(p_location_names := null)` RPC を呼び、
 *     ユーザーの権限のまま許可 location_id 集合を解決する（SECURITY DEFINER だが
 *     auth.uid() は「載せた JWT のユーザー」になるため、owner は自テナント全店、
 *     staff は自店のみが返る。service role は一切登場せず SEC-1/SEC-2 が透過的に効く）。
 *   - 同 JWT クライアントで locations_meta を SELECT し start_hour / name map を取得。
 *
 * 認可ポリシー:
 *   - 未認証（Bearer 無し）              → 401（AuthError）。
 *   - RPC error / allowedIds が null     → 401（fail-closed）。
 *   - allowedIds が空集合（無権限）      → 401（fail-closed）。
 *
 * R3（実装直後ゲート / 2026-06-10 検証メモ）:
 *   `createClient(url, ANON_KEY, { global: { headers: { Authorization: 'Bearer <jwt>' }}})`
 *   は supabase-js v2 のサーバ側ステートレス per-request 認証パターン。
 *   この header は PostgREST へ毎回送られ、PostgREST が JWT をデコードして
 *   `request.jwt.claims` を設定 → `auth.uid()` が `sub` から解決される。
 *   よって SECURITY DEFINER RPC 内の `auth.uid()` が「載せた JWT のユーザー」になる。
 *   ブラウザ側 supabaseSquare.ts が `setSession` を使うのは GoTrue セッションを
 *   永続化するためで、refresh_token を要する。サーバ側は refresh_token を持たない
 *   ステートレス実行のため header 注入が正解（setSession は使わない）。
 *   ※ 実 JWT での疎通（staff/owner で正しいスコープが返るか）はデプロイ後の
 *     P1 完了ゲート（§6 / §7.1-2）で curl 実検証する。
 */

import { createClient } from '@supabase/supabase-js';

/**
 * デフォルトの営業日開始時間（時）。
 * locations_meta に行が無い location は必ずこの値にフォールバックする。
 * 見本 _store_hours.js から移送（全7店 business_day_start_hour=11 が正本）。
 * @type {number}
 */
export const DEFAULT_BUSINESS_DAY_START_HOUR = 11;

/**
 * 認可エラー。status（401/403）を持つ。endpoint 側で res.status(err.status) に使う。
 */
export class AuthError extends Error {
  /**
   * @param {string} message
   * @param {number} [status=401]
   */
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * サーバ env を取得。無ければ throw（fail-closed）。
 * @param {string} name
 * @returns {string}
 */
function envOrThrow(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required server env: ${name}`);
  }
  return v;
}

/**
 * リクエストの Authorization ヘッダから Bearer JWT を抽出。
 * @param {import('http').IncomingMessage} req
 * @returns {string} JWT
 * @throws {AuthError} Bearer が無い場合 401
 */
function extractBearer(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthError('Empty bearer token', 401);
  }
  return token;
}

/**
 * 渡された JWT をリクエストヘッダに載せた square_dashboard スキーマ固定クライアントを生成。
 *   - anon key を使う（service role は一切使わない）。
 *   - global.headers.Authorization に Bearer JWT を載せる（per-request 認証）。
 *   - 自前のセッションは持たない（persistSession:false / autoRefreshToken:false）。
 * @param {string} jwt
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createScopedClient(jwt) {
  const url = envOrThrow('SUPABASE_URL');
  const anonKey = envOrThrow('SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    db: { schema: 'square_dashboard' },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });
}

/**
 * リクエストを認可し、ユーザーの許可 location_id 集合と start_hour / name map を返す。
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{
 *   allowedLocationIds: string[],
 *   startHourMap: Record<string, number>,
 *   nameMap: Record<string, string>,
 * }>}
 * @throws {AuthError} 未認証・無権限・スコープ外は 401。
 */
export async function authenticate(req) {
  const jwt = extractBearer(req);
  const client = createScopedClient(jwt);

  // 包含チェック一本化方針（§2.2）: p_location_names は使わず null（=全許可集合）を取得。
  const { data: allowedIds, error } = await client.rpc('get_allowed_location_ids', {
    p_location_names: null,
  });

  if (error || !allowedIds) {
    // RPC エラー（権限なし schema 拒否含む）は fail-closed で 401。
    throw new AuthError('Failed to resolve allowed locations', 401);
  }
  if (!Array.isArray(allowedIds) || allowedIds.length === 0) {
    // スコープ外 / 無権限ユーザー。
    throw new AuthError('No allowed locations for this user', 401);
  }

  // locations_meta を同 JWT クライアントで SELECT（RLS 通過・service role 不使用）。
  const { data: metaRows, error: metaError } = await client
    .from('locations_meta')
    .select('location_id,location_name,business_day_start_hour')
    .in('location_id', allowedIds);

  /** @type {Record<string, number>} */
  const startHourMap = {};
  /** @type {Record<string, string>} */
  const nameMap = {};

  if (!metaError && Array.isArray(metaRows)) {
    for (const row of metaRows) {
      if (row.location_id == null) continue;
      if (typeof row.business_day_start_hour === 'number') {
        startHourMap[row.location_id] = Number(row.business_day_start_hour);
      }
      if (row.location_name != null) {
        nameMap[row.location_id] = row.location_name;
      }
    }
  }

  return { allowedLocationIds: allowedIds, startHourMap, nameMap };
}

/**
 * 単一 location の start_hour を解決する。map に無ければ既定 11。
 * @param {Record<string, number>} startHourMap
 * @param {string} locationId
 * @returns {number} 0-23。未登録なら DEFAULT_BUSINESS_DAY_START_HOUR (11)
 */
export function resolveStartHour(startHourMap, locationId) {
  return startHourMap?.[locationId] ?? DEFAULT_BUSINESS_DAY_START_HOUR;
}

/**
 * リクエストされた location_id がユーザーの許可集合に含まれるか（包含チェック・§2.2）。
 * フロント制御は信用せず、サーバ側のこの判定を最終強制とする。
 * @param {string[]} allowedLocationIds
 * @param {string} locationId
 * @returns {boolean}
 */
export function assertLocationAllowed(allowedLocationIds, locationId) {
  if (!Array.isArray(allowedLocationIds) || !locationId) return false;
  return allowedLocationIds.includes(locationId);
}
