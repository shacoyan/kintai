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
 */


export function setCors(req, res, methods = 'GET, OPTIONS') {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return req.method === 'OPTIONS';
}


export function squareHeaders() {
  return {
    'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-18'
  };
}

export function parseTimeRange({ date, start_hour, end_hour }) {
  const startHour = parseInt(start_hour ?? '0', 10);
  const endHour = end_hour !== undefined ? parseInt(end_hour, 10) : (startHour > 0 ? startHour - 1 : 23);
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

export async function fetchCustomers(customerIds) {
  const customersMap = {};
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const batch = uniqueIds.slice(i, i + 100);
    try {
      const res = await fetch('https://connect.squareup.com/v2/customers/bulk-retrieve', {
        method: 'POST',
        headers: squareHeaders(),
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
    } catch { /* 失敗しても続行 */ }
  }

  return customersMap;
}

const HH = (h) => String(h).padStart(2, '0');

export function parseRangeTimeRange({ start_date, end_date, start_hour, end_hour }) {
  const startHour = parseInt(start_hour ?? '0', 10);
  const endHour = end_hour !== undefined ? parseInt(end_hour, 10) : (startHour > 0 ? startHour - 1 : 23);
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

export async function fetchAllPayments({ beginTimeJST, endTimeJST, location_id }) {
  const payments = [];
  let cursor = undefined;

  do {
    const params = new URLSearchParams({
      begin_time: beginTimeJST,
      end_time: endTimeJST,
      location_id: location_id,
      limit: '200',
    });
    if (cursor) params.append('cursor', cursor);

    const res = await fetch(`https://connect.squareup.com/v2/payments?${params.toString()}`, {
      headers: squareHeaders(),
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

export async function fetchOrdersBatch(orderIds) {
  const ordersMap = {};
  const uniqueIds = [...new Set(orderIds.filter(Boolean))];

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const batch = uniqueIds.slice(i, i + 100);
    try {
      const res = await fetch('https://connect.squareup.com/v2/orders/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(),
        body: JSON.stringify({ order_ids: batch })
      });

      if (res.ok) {
        const data = await res.json();
        for (const order of data.orders ?? []) {
          ordersMap[order.id] = order;
        }
      }
    } catch { /* 失敗しても続行 */ }
  }

  return ordersMap;
}

export async function fetchCatalogVariationCategoryMap(ordersMap) {
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
  for (let i = 0; i < catalogObjectIds.length; i += 100) {
    const batch = catalogObjectIds.slice(i, i + 100);
    try {
      const catalogRes = await fetch('https://connect.squareup.com/v2/catalog/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(),
        body: JSON.stringify({ object_ids: batch, include_related_objects: true })
      });
      if (!catalogRes.ok) {
        console.error('Catalog API error (stage1):', catalogRes.status, await catalogRes.text());
        continue;
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
  }

  // 第2段階: CATEGORY を取得
  const categoryIds = [...new Set(Object.values(itemToCategoryId).filter(Boolean))];
  const categoryIdToName = {};

  for (let i = 0; i < categoryIds.length; i += 100) {
    const batch = categoryIds.slice(i, i + 100);
    try {
      const catRes = await fetch('https://connect.squareup.com/v2/catalog/batch-retrieve', {
        method: 'POST',
        headers: squareHeaders(),
        body: JSON.stringify({ object_ids: batch })
      });
      if (!catRes.ok) {
        console.error('Catalog API error (stage2):', catRes.status, await catRes.text());
        continue;
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
  }

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
