/**
 * api/_shared.js
 * Square Dashboard API 共通ユーティリティ（kintai Wave4 移植版）
 *
 * 見本 square-dashboard/api/_shared.js から移植。改変点:
 *   - validateToken（base64 トークン方式）と VALID_LABELS を削除。
 *     認可は api/_auth.js（Bearer JWT 検証 + get_allowed_location_ids スコープ解決）が代替。
 *   - setCors / squareHeaders / parseTimeRange / parseRangeTimeRange / computeBusinessDate /
 *     fetchCustomers / fetchAllPayments / fetchOrdersBatch / fetchCatalogVariationCategoryMap /
 *     normalizePaymentsForReporting は無改変（Square fetch ロジックは見本パリティ）。
 *   - env は SQUARE_ACCESS_TOKEN（kintai 標準）。
 *
 * Phase 2（2026-07-22 デュアルトークン合算・square-dashboard Phase 1/2 と同型）:
 *   - squareHeaders(token = process.env.SQUARE_ACCESS_TOKEN) / getSquareTokens() は
 *     square-dashboard/api/_shared.js（Phase 1 実装 L38-44 / L53-74）からの無改変移植。
 *   - fetchAllPayments / fetchOrdersBatch / fetchCatalogVariationCategoryMap / fetchCustomers は
 *     token 引数を追加（省略時は現行 = squareHeaders() デフォルト経由で完全同一）。
 *   - nameGroupKey / fetchAllLocationsMulti / expandSameNameLocations / dedupeLocationsByName /
 *     resolveSameNameLocationGroup は square-dashboard Phase 2 と同名・同セマンティクスの新規実装
 *     （fetchAllLocationsMulti は squareFetch 経由の独立実装。TARGET_LOCATION_NAMES /
 *     fetchTargetLocationsMulti は kintai に移植しない = 対象集合は DB 認可が正）。
 */


/**
 * CORS 許可オリジン解決。
 *   ALLOWED_ORIGIN（カンマ区切り可）を許可リストとして扱い、
 *   リクエスト Origin が一致した時のみその Origin を返す。
 *   未設定時は `*` フォールバックを撤去し、何も許可しない（fail-closed）。
 *   本番は ALLOWED_ORIGIN を必ず設定すること。
 */
export function setCors(req, res, methods = 'GET, OPTIONS') {
  const allowList = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const reqOrigin = req.headers?.origin;

  if (allowList.includes('*')) {
    // 明示的に全許可を意図した場合のみ `*` を返す。
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (reqOrigin && allowList.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
  }
  // 許可リストに無い/未設定なら Access-Control-Allow-Origin を出さない（ブラウザがブロック）。

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return req.method === 'OPTIONS';
}

/**
 * 'YYYY-MM-DD' 形式かつ実在する日付か判定。
 *   '2026-02-31' のような Date round-trip で別日に化けるケースを弾く。
 *   全 endpoint 共用（旧 sales-range / open-orders-range / transactions-range のインライン実装を集約）。
 */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const roundtrip = d.toISOString().slice(0, 10);
  return roundtrip === s;
}

/**
 * 時:0-23 にクランプし、NaN/範囲外は fallback を返す。
 */
function clampHour(raw, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

// range 系の最大日数ガード / cursor ページング上限。
export const MAX_RANGE_DAYS = 366;
const MAX_PAYMENT_PAGES = 1000; // limit=200 → 最大 20万件相当。暴走/無限ループ防止。

// Square fetch のタイムアウト（無限待ち防止）と並列バッチの同時実行数。
// 取得方法の最適化のみ。集計結果・取得件数は不変（並列でも Map 集約は順序非依存）。
const SQUARE_FETCH_TIMEOUT_MS = 9000;
const FETCH_CONCURRENCY = 4;

/**
 * AbortSignal.timeout を付与した fetch ラッパ。
 *   Square API への全 fetch を共通のタイムアウトで保護する。
 *   呼び出し側の signal 指定（既存）は無いので、ここで一律 timeout を注入する。
 *   タイムアウト時は AbortError が throw されるため、呼び出し側の既存
 *   try/catch（fail-soft バッチ）や !res.ok→throw（直列致命パス）と同じ経路で扱われる。
 */
function squareFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(SQUARE_FETCH_TIMEOUT_MS) });
}

/**
 * 配列 items を同時実行数 concurrency のチャンクに分けて worker を並列実行する自前セマフォ。
 *   p-limit 等の外部依存を足さず Promise.all のチャンク化で並列度を制御する。
 *   worker の戻り値は使わず副作用（Map への代入）で結果を集約する想定。
 *   ＝順序非依存なので並列化前後で最終結果は完全同一。
 */
async function runWithConcurrency(items, concurrency, worker) {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

/**
 * start_date / end_date（両端含む）の日数を返す。invalid なら NaN。
 */
export function rangeDays(start_date, end_date) {
  if (!isValidDateStr(start_date) || !isValidDateStr(end_date)) return NaN;
  const s = new Date(start_date + 'T00:00:00Z').getTime();
  const e = new Date(end_date + 'T00:00:00Z').getTime();
  return Math.floor((e - s) / 86400000) + 1;
}


export function squareHeaders(token = process.env.SQUARE_ACCESS_TOKEN) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-18'
  };
}

/**
 * 設定済み Square アクセストークンの列挙。
 * - ''/空白のみは「未設定」として扱う
 * - SQUARE_ACCESS_TOKEN_2 === SQUARE_ACCESS_TOKEN は値 dedupe して 1 件扱い
 * - 0 件は throw（SQUARE_ACCESS_TOKEN すら未設定の壊れた構成）
 * square-dashboard/api/_shared.js（Phase 1）L53-74 の無改変移植。
 * @returns {Array<{ tokenIndex: 1|2, envKey: string, token: string }>}
 */
export function getSquareTokens() {
  const raw = [
    { tokenIndex: 1, envKey: 'SQUARE_ACCESS_TOKEN', token: process.env.SQUARE_ACCESS_TOKEN },
    { tokenIndex: 2, envKey: 'SQUARE_ACCESS_TOKEN_2', token: process.env.SQUARE_ACCESS_TOKEN_2 },
  ];

  const configured = raw.filter(t => typeof t.token === 'string' && t.token.trim() !== '');

  const seen = new Set();
  const deduped = [];
  for (const t of configured) {
    if (seen.has(t.token)) continue;
    seen.add(t.token);
    deduped.push(t);
  }

  if (deduped.length === 0) {
    throw new Error('No Square access token configured (SQUARE_ACCESS_TOKEN is required)');
  }

  return deduped;
}

export function parseTimeRange({ date, start_hour, end_hour }) {
  const startHour = clampHour(start_hour ?? '0', 0);
  const endHour = end_hour !== undefined
    ? clampHour(end_hour, startHour > 0 ? startHour - 1 : 23)
    : (startHour > 0 ? startHour - 1 : 23);
  const isNextDay = endHour < startHour;
  const endDate = isNextDay ? (() => {
    const d = new Date(date + 'T12:00:00+09:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })() : date;

  return {
    beginTimeJST: `${date}T${String(startHour).padStart(2, '0')}:00:00+09:00`,
    endTimeJST: `${endDate}T${String(endHour).padStart(2, '0')}:59:59.999+09:00`
  };
}

export async function fetchCustomers(customerIds, token) {
  const customersMap = {};
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];

  // 100 件刻みのバッチを生成して並列実行（同時実行数 FETCH_CONCURRENCY）。
  // 各バッチは Map(customersMap) のキー集約なので順序非依存＝並列化前後で結果不変。
  const batches = [];
  for (let i = 0; i < uniqueIds.length; i += 100) {
    batches.push(uniqueIds.slice(i, i + 100));
  }

  await runWithConcurrency(batches, FETCH_CONCURRENCY, async (batch) => {
    try {
      const res = await squareFetch('https://connect.squareup.com/v2/customers/bulk-retrieve', {
        method: 'POST',
        headers: squareHeaders(token),
        body: JSON.stringify({ customer_ids: batch })
      });
      if (res.ok) {
        const data = await res.json();
        for (const [id, entry] of Object.entries(data.responses ?? {})) {
          const c = entry.customer ?? entry;
          const given = c.given_name ?? '';
          const family = c.family_name ?? '';
          customersMap[id] = [family, given].filter(Boolean).join(' ') || null;
        }
      }
    } catch { /* 失敗しても続行（タイムアウト含む fail-soft）。顧客名は欠損許容 */ }
  });

  return customersMap;
}

const HH = (h) => String(h).padStart(2, '0');

export function parseRangeTimeRange({ start_date, end_date, start_hour, end_hour }) {
  const startHour = clampHour(start_hour ?? '0', 0);
  const endHour = end_hour !== undefined
    ? clampHour(end_hour, startHour > 0 ? startHour - 1 : 23)
    : (startHour > 0 ? startHour - 1 : 23);
  const isNextDay = endHour < startHour;

  const beginTimeJST = `${start_date}T${HH(startHour)}:00:00+09:00`;

  let endTimeJST;
  if (isNextDay) {
    const d = new Date(end_date + 'T12:00:00+09:00');
    d.setDate(d.getDate() + 1);
    const nextDay = d.toISOString().split('T')[0];
    endTimeJST = `${nextDay}T${HH(endHour)}:59:59.999+09:00`;
  } else {
    endTimeJST = `${end_date}T${HH(endHour)}:59:59.999+09:00`;
  }

  return { beginTimeJST, endTimeJST };
}

export function computeBusinessDate(createdAtISO, startHour) {
  const d = new Date(createdAtISO);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);

  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const day = jst.getUTCDate();
  const hour = jst.getUTCHours();

  // hour < startHour の場合は前日業務日扱い。月またぎ/年またぎを正しく処理するため
  // Date オブジェクト経由で -1 日する。
  const baseDate = new Date(Date.UTC(y, m, day));
  if (hour < startHour) {
    baseDate.setUTCDate(baseDate.getUTCDate() - 1);
  }

  const yy = baseDate.getUTCFullYear();
  const mm = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getUTCDate()).padStart(2, '0');

  return `${yy}-${mm}-${dd}`;
}

export async function fetchAllPayments({ beginTimeJST, endTimeJST, location_id, token }) {
  const payments = [];
  let cursor = undefined;
  let pages = 0;

  do {
    if (++pages > MAX_PAYMENT_PAGES) {
      throw new Error(`fetchAllPayments exceeded ${MAX_PAYMENT_PAGES} pages (possible runaway pagination)`);
    }
    const params = new URLSearchParams({
      begin_time: beginTimeJST,
      end_time: endTimeJST,
      location_id: location_id,
      limit: '200',
    });
    if (cursor) params.append('cursor', cursor);

    // cursor ページングは前レスポンス依存のため直列維持（並列化対象外）。
    // タイムアウトのみ付与し、無限待ちを防ぐ。AbortError は下の !res.ok と同列で
    // catch されず上位へ伝播し、致命パスとして明示エラー化される。
    const res = await squareFetch(`https://connect.squareup.com/v2/payments?${params.toString()}`, {
      headers: squareHeaders(token),
    });

    if (!res.ok) {
      throw new Error(`Square API Error: ${res.status}`);
    }

    const data = await res.json();
    if (data.payments) payments.push(...data.payments);
    cursor = data.cursor;
  } while (cursor);

  return payments;
}

export async function fetchOrdersBatch(orderIds, token) {
  const ordersMap = {};
  const uniqueIds = [...new Set(orderIds.filter(Boolean))];

  // 100 件刻みのバッチを並列実行。order.id をキーに Map 集約＝順序非依存で結果不変。
  const batches = [];
  for (let i = 0; i < uniqueIds.length; i += 100) {
    batches.push(uniqueIds.slice(i, i + 100));
  }

  await runWithConcurrency(batches, FETCH_CONCURRENCY, async (batch) => {
    try {
      const res = await squareFetch('https://connect.squareup.com/v2/orders/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(token),
        body: JSON.stringify({ order_ids: batch })
      });

      if (res.ok) {
        const data = await res.json();
        for (const order of data.orders ?? []) {
          ordersMap[order.id] = order;
        }
      }
    } catch { /* 失敗しても続行（タイムアウト含む fail-soft） */ }
  });

  return ordersMap;
}

export async function fetchCatalogVariationCategoryMap(ordersMap, token) {
  const catalogObjectIds = [...new Set(
    Object.values(ordersMap).flatMap(order =>
      (order.line_items ?? [])
        .filter(item => parseFloat(item.quantity) > 0 && item.catalog_object_id)
        .map(item => item.catalog_object_id)
    )
  )];

  const variationToItemId = {};
  const itemToCategoryId = {};

  // 第1段階: ITEM_VARIATION と ITEM を取得（include_related_objects: true）
  // 100 件刻みのバッチを並列実行。variationToItemId / itemToCategoryId は id キー集約＝順序非依存で結果不変。
  const stage1Batches = [];
  for (let i = 0; i < catalogObjectIds.length; i += 100) {
    stage1Batches.push(catalogObjectIds.slice(i, i + 100));
  }

  await runWithConcurrency(stage1Batches, FETCH_CONCURRENCY, async (batch) => {
    try {
      const catalogRes = await squareFetch('https://connect.squareup.com/v2/catalog/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(token),
        body: JSON.stringify({ object_ids: batch, include_related_objects: true })
      });
      if (!catalogRes.ok) {
        console.error('Catalog API error (stage1):', catalogRes.status, await catalogRes.text());
        return;
      }
      const catalogData = await catalogRes.json();
      for (const obj of (catalogData.objects ?? [])) {
        if (obj.type === 'ITEM_VARIATION') {
          variationToItemId[obj.id] = obj.item_variation_data?.item_id ?? null;
        }
      }
      for (const obj of (catalogData.related_objects ?? [])) {
        if (obj.type === 'ITEM') {
          const catId = obj.item_data?.reporting_category?.id ?? null;
          if (catId) itemToCategoryId[obj.id] = catId;
        }
      }
    } catch (e) {
      console.error('Catalog batch error (stage1):', e);
    }
  });

  // 第2段階: CATEGORY を取得
  const categoryIds = [...new Set(Object.values(itemToCategoryId).filter(Boolean))];
  const categoryIdToName = {};

  // 100 件刻みのバッチを並列実行。categoryIdToName は id キー集約＝順序非依存で結果不変。
  const stage2Batches = [];
  for (let i = 0; i < categoryIds.length; i += 100) {
    stage2Batches.push(categoryIds.slice(i, i + 100));
  }

  await runWithConcurrency(stage2Batches, FETCH_CONCURRENCY, async (batch) => {
    try {
      const catRes = await squareFetch('https://connect.squareup.com/v2/catalog/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(token),
        body: JSON.stringify({ object_ids: batch })
      });
      if (!catRes.ok) {
        console.error('Catalog API error (stage2):', catRes.status, await catRes.text());
        return;
      }
      const catData = await catRes.json();
      for (const obj of (catData.objects ?? [])) {
        if (obj.type === 'CATEGORY') {
          categoryIdToName[obj.id] = obj.category_data?.name ?? null;
        }
      }
    } catch (e) {
      console.error('Catalog batch error (stage2):', e);
    }
  });

  const localVariationCategoryMap = {};
  for (const [varId, itemId] of Object.entries(variationToItemId)) {
    if (!itemId) { localVariationCategoryMap[varId] = null; continue; }
    const catId = itemToCategoryId[itemId];
    if (catId) {
      const catName = categoryIdToName[catId] ?? null;
      localVariationCategoryMap[varId] = { id: catId, name: catName };
    } else {
      localVariationCategoryMap[varId] = null;
    }
  }

  return localVariationCategoryMap;
}

/**
 * Square Web レポートと整合するため、payments を正規化する:
 * - COMPLETED 以外を除外（FAILED/CANCELED など）
 * - 全額返金済みを除外
 * - 部分返金は amount_money.amount を純額に差し替え
 *
 * @param {Array} payments - Square API /v2/payments のレスポンス payments 配列
 * @returns {Array} 正規化後の payments
 */
export function normalizePaymentsForReporting(payments) {
  return payments
    .filter(p => p.status === 'COMPLETED')
    .flatMap(p => {
      const gross = p.amount_money?.amount ?? 0;
      const refunded = p.refunded_money?.amount ?? 0;
      if (refunded <= 0) return [p];
      if (refunded >= gross) return []; // 全額返金 → 除外
      // 部分返金 → 売上を純額に差し替え
      return [{ ...p, amount_money: { ...p.amount_money, amount: gross - refunded } }];
    });
}

// ========== Phase 2（2026-07-22 デュアルトークン合算・square-dashboard と同名・同セマンティクス） ==========

/**
 * name group キー正規化（純関数）。
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function nameGroupKey(name) {
  return String(name ?? '').trim();
}

/**
 * 設定済み全トークンで /v2/locations を取得し、location_id で dedupe して合算する
 * 無フィルタ版。片トークン失敗は fail-soft で続行し、全トークン失敗のみ throw する。
 * square-dashboard/api/_shared.js の fetchTargetLocationsMulti と同一規約・同一 shape
 * （tokenSummary にフィールド追加禁止）だが、kintai は squareFetch（timeout 付き）経由の
 * 独立実装とし、店舗名フィルタは行わない（対象集合は DB 認可 = allowedLocationIds が正）。
 * @returns {Promise<{ locations: Array, tokenSummary: Array }>}
 */
export async function fetchAllLocationsMulti() {
  const tokens = getSquareTokens();

  const tokenSummary = [];
  const mergedLocations = [];
  const seenLocationIds = new Set();
  const errors = [];

  for (const { tokenIndex, envKey, token } of tokens) {
    try {
      const res = await squareFetch('https://connect.squareup.com/v2/locations', {
        headers: squareHeaders(token),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(`Square /v2/locations failed: ${res.status} - ${bodyText}`);
      }

      const data = await res.json();
      const locs = data.locations || [];

      for (const loc of locs) {
        if (seenLocationIds.has(loc.id)) continue;
        seenLocationIds.add(loc.id);
        mergedLocations.push({ ...loc, _token: token, _tokenIndex: tokenIndex });
      }

      tokenSummary.push({
        token_index: tokenIndex,
        env_key: envKey,
        ok: true,
        location_count: locs.length,
        error: null,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      errors.push(errorMessage);
      tokenSummary.push({
        token_index: tokenIndex,
        env_key: envKey,
        ok: false,
        location_count: 0,
        error: errorMessage,
      });
    }
  }

  if (tokenSummary.every(t => !t.ok)) {
    throw new Error(`All Square tokens failed to fetch locations: ${errors.join(' | ')}`);
  }

  return { locations: mergedLocations, tokenSummary };
}

/**
 * 決定的ソート比較関数: tokenIndex 降順 → id 昇順（辞書順）。
 * 新アカウント（tokenIndex 大）優先の代表選出・展開順に共通利用する純関数。
 */
function byTokenIndexDescThenIdAsc(a, b) {
  if (b.tokenIndex !== a.tokenIndex) return b.tokenIndex - a.tokenIndex;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * 同名グループ展開（純関数・fetch しない）。
 * @param {Array} locations - fetchAllLocationsMulti() の locations（_token/_tokenIndex 付き）
 * @param {string} locationId - 展開の起点となる要求 location_id
 * @returns {{ groupName: string|null, members: Array<{ id, token, tokenIndex }> }}
 */
export function expandSameNameLocations(locations, locationId) {
  const target = (locations || []).find(l => l.id === locationId);
  if (!target) return { groupName: null, members: [] };

  const key = nameGroupKey(target.name);
  const members = (locations || [])
    .filter(l => nameGroupKey(l.name) === key)
    .map(l => ({ id: l.id, token: l._token, tokenIndex: l._tokenIndex }))
    .sort(byTokenIndexDescThenIdAsc);

  return { groupName: key, members };
}

/**
 * locations 一覧の name dedupe（純関数）。
 * - 出力順 = nameGroupKey の初出順（入力順保存）
 * - 各グループの代表 = tokenIndex 降順 → id 昇順の先頭（= 新アカウント優先・決定的）
 * - 単一トークン時は入力と完全同一（順序・件数・要素）
 * @param {Array} locations
 * @returns {Array}
 */
export function dedupeLocationsByName(locations) {
  const order = [];
  const groups = new Map();

  for (const loc of (locations || [])) {
    const key = nameGroupKey(loc.name);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(loc);
  }

  return order.map((key) => {
    const group = groups.get(key);
    group.sort(byTokenIndexDescThenIdAsc);
    return group[0];
  });
}

/**
 * 統合オーケストレータ（各エンドポイントが呼ぶ唯一の入口）。
 * - 内部で getSquareTokens() → fetchAllLocationsMulti()（片 token 失敗は fail-soft）
 *   → expandSameNameLocations。
 * - 片 token の locations 取得失敗 → warnings に token_locations_failed（error 全文・token 値なし）。
 * - 要求 id 未解決（全 token 失敗 / 失敗 token 配下 / 不明 id）→
 *   members = [{ id: locationId, token: tokens[0].token, tokenIndex: tokens[0].tokenIndex }]
 *   + warnings に location_unresolved。fetchAllLocationsMulti の全滅 throw は内部 catch する
 *   （NEVER throws。例外は getSquareTokens の 0 件 throw のみ）。
 * - allowedLocationIds（配列）指定時: members を積集合に制限（kintai 認可 fail-closed 用）。
 * @param {string} locationId
 * @param {{ allowedLocationIds?: string[]|null }} [options]
 * @returns {Promise<{ groupName: string|null, members: Array, tokenSummary: Array, warnings: Array }>}
 */
export async function resolveSameNameLocationGroup(locationId, { allowedLocationIds = null } = {}) {
  const tokens = getSquareTokens(); // 0 件のみ throw（現行も壊れている構成）

  const warnings = [];
  let locations = [];
  let tokenSummary = [];

  try {
    const result = await fetchAllLocationsMulti();
    locations = result.locations;
    tokenSummary = result.tokenSummary;
    for (const t of tokenSummary) {
      if (!t.ok) {
        warnings.push({
          type: 'token_locations_failed',
          token_index: t.token_index,
          env_key: t.env_key,
          error: t.error,
        });
      }
    }
  } catch (e) {
    // fetchAllLocationsMulti の全滅 throw を内部 catch（NEVER throws）。
    const errorMessage = e instanceof Error ? e.message : String(e);
    for (const t of tokens) {
      warnings.push({
        type: 'token_locations_failed',
        token_index: t.tokenIndex,
        env_key: t.envKey,
        error: errorMessage,
      });
    }
    locations = [];
    tokenSummary = [];
  }

  let { groupName, members } = expandSameNameLocations(locations, locationId);

  if (members.length === 0 || !members.some(m => m.id === locationId)) {
    const fallback = tokens[0];
    members = [{ id: locationId, token: fallback.token, tokenIndex: fallback.tokenIndex }];
    groupName = null;
    warnings.push({ type: 'location_unresolved', location_id: locationId });
  }

  if (Array.isArray(allowedLocationIds)) {
    const allowedSet = new Set(allowedLocationIds);
    members = members.filter(m => allowedSet.has(m.id));
  }

  return { groupName, members, tokenSummary, warnings };
}
