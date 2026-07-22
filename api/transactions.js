import { setCors, squareHeaders, parseTimeRange, fetchCustomers, fetchCatalogVariationCategoryMap, fetchOrdersBatch, normalizePaymentsForReporting, isValidDateStr, resolveSameNameLocationGroup } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

// maxDuration は vercel.json の functions に一本化（inline config と二重定義していたため撤去）。

// 1 メンバー（同名グループ内の 1 location・1 token）分の payments を cursor ページングで全件取得。
// 失敗時は throw（呼び出し側 Promise.all で全体エラーへ集約・部分金額を返さない）。
async function fetchMemberPayments(member, beginTimeJST, endTimeJST) {
  let memberPayments = [];
  let cursor = undefined;
  let pages = 0;

  do {
    if (++pages > 1000) {
      console.error('transactions.js pagination runaway (>1000 pages)');
      throw new Error('Failed to fetch payments from Square API');
    }
    let url = `https://connect.squareup.com/v2/payments?begin_time=${encodeURIComponent(beginTimeJST)}&end_time=${encodeURIComponent(endTimeJST)}&location_id=${encodeURIComponent(member.id)}&limit=200`;

    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: squareHeaders(member.token)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Square API error:', response.status, errorBody);
      const err = new Error('Failed to fetch payments from Square API');
      err.upstreamStatus = response.status;
      throw err;
    }

    const data = await response.json();

    if (data.payments) {
      memberPayments = memberPayments.concat(data.payments);
    }

    cursor = data.cursor || undefined;
  } while (cursor);

  return memberPayments;
}

export default async (req, res) => {
  if (setCors(req, res)) {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // JWT 検証 + スコープ解決。service role 不使用。
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    const { date, location_id, end_hour } = req.query;

    if (!date || !location_id) {
      return res.status(400).json({ error: 'date and location_id are required' });
    }

    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'date must be valid YYYY-MM-DD' });
    }

    // 越権ガード: 要求 location_id が許可集合に無ければ空配列を返す（存在を漏らさない・§2.2）。
    // 展開ロジック（resolveSameNameLocationGroup）はこの後にのみ到達する（fail-closed・§7）。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ transactions: [] });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(startHourMap)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。要求 location_id 由来で不変（§9）。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const resolvedStartHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseTimeRange({ date, start_hour: resolvedStartHour, end_hour });

    // 同名グループ展開（許可集合との積集合に限定・fail-closed）。
    const { members, warnings } = await resolveSameNameLocationGroup(location_id, { allowedLocationIds });

    let memberPaymentsList;
    try {
      memberPaymentsList = await Promise.all(
        members.map((member) => fetchMemberPayments(member, beginTimeJST, endTimeJST))
      );
    } catch (error) {
      console.error('Error fetching transactions (member):', error);
      return res.status(502).json({
        error: 'Failed to fetch payments from Square API',
        ...(error.upstreamStatus ? { upstream_status: error.upstreamStatus } : {})
      });
    }

    // COMPLETED 抽出 + 返金正規化（Square Web レポート整合）。concat 後に 1 回適用（§9）。
    let allPayments = normalizePaymentsForReporting(memberPaymentsList.flat());

    // orders / customers / catalog は「その payment が来た token」でのみ取得（token 跨ぎ取得禁止）。
    // メンバー間は並列可・マージは tokenIndex 昇順に代入（後勝ち = 新優先・§9）。
    const perMemberMaps = await Promise.all(
      members.map(async (member, i) => {
        const memberPayments = memberPaymentsList[i];
        const orderIds = [...new Set(
          memberPayments.filter(p => p.order_id).map(p => p.order_id)
        )];
        const memberOrdersMap = await fetchOrdersBatch(orderIds, member.token);

        // catalog取得とcustomers取得を並列実行。
        // catalog は _shared.js の共有実装（variationId → {id,name} を返す正実装）を使う。
        // 旧インライン実装は variationId → string を返していたため後段の `?.name` 参照で
        // category が常に null に潰れていた（裁定 a・継承バグ）。共有実装に統一して恒久修正。
        const customerIds = memberPayments.filter(p => p.customer_id).map(p => p.customer_id);
        const [memberCustomersMap, memberCatalogMap] = await Promise.all([
          fetchCustomers(customerIds, member.token),
          fetchCatalogVariationCategoryMap(memberOrdersMap, member.token)
        ]);

        return {
          tokenIndex: member.tokenIndex,
          ordersMap: memberOrdersMap,
          customersMap: memberCustomersMap,
          catalogMap: memberCatalogMap
        };
      })
    );

    perMemberMaps.sort((a, b) => a.tokenIndex - b.tokenIndex);

    const ordersMap = {};
    const customersMap = {};
    const variationCategoryMap = {};
    for (const m of perMemberMaps) {
      Object.assign(ordersMap, m.ordersMap);
      Object.assign(customersMap, m.customersMap);
      Object.assign(variationCategoryMap, m.catalogMap);
    }

    const transactions = allPayments.map(payment => {
      const order = payment.order_id ? ordersMap[payment.order_id] : null;
      const lineItems = (order?.line_items ?? [])
        .filter(item => parseFloat(item.quantity) > 0)
        .map(item => ({
          name: item.name ?? '不明',
          quantity: item.quantity,
          amount: item.gross_sales_money?.amount ?? 0,
          category: variationCategoryMap[item.catalog_object_id]?.name ?? null
        }));
      return {
        id: payment.id,
        created_at_jst: payment.created_at ?? null,
        order_created_at_jst: order?.created_at ?? null,
        amount: payment.amount_money?.amount ?? 0,
        status: payment.status,
        source: payment.source_type ?? 'CARD',
        customer_name: payment.customer_id ? (customersMap[payment.customer_id] ?? null) : null,
        line_items: lineItems,
        discounts: (order?.discounts ?? []).map(d => ({
          name: d.name ?? '割引',
          amount: d.applied_money?.amount ?? 0
        }))
      };
    });

    transactions.sort((a, b) => {
      if (!a.created_at_jst) return 1;
      if (!b.created_at_jst) return -1;
      return new Date(b.created_at_jst).getTime() - new Date(a.created_at_jst).getTime();
    });

    const body = { transactions };
    if (warnings && warnings.length > 0) {
      body.warnings = warnings;
    }

    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching transactions:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
