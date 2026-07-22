import { setCors, parseRangeTimeRange, computeBusinessDate, fetchAllPayments, fetchOrdersBatch, fetchCatalogVariationCategoryMap, fetchCustomers, normalizePaymentsForReporting, isValidDateStr, rangeDays, MAX_RANGE_DAYS, resolveSameNameLocationGroup } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

export default async (req, res) => {
  if (setCors(req, res)) return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // JWT 検証 + スコープ解決。service role 不使用。
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    const { start_date, end_date, location_id, end_hour } = req.query;
    if (!start_date || !end_date || !location_id) {
      return res.status(400).json({ error: 'start_date, end_date and location_id are required' });
    }

    if (!isValidDateStr(start_date) || !isValidDateStr(end_date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'start_date / end_date must be valid YYYY-MM-DD' });
    }

    if (start_date > end_date) {
      return res.status(400).json({ error: 'invalid_date_range', message: 'start_date must be <= end_date' });
    }

    if (rangeDays(start_date, end_date) > MAX_RANGE_DAYS) {
      return res.status(400).json({ error: 'range_too_large', message: `date range must be <= ${MAX_RANGE_DAYS} days` });
    }

    // 越権ガード: 要求 location_id が許可集合に無ければ空を返す（存在を漏らさない・§2.2）。
    // 展開ロジック（resolveSameNameLocationGroup）はこの後にのみ到達する（fail-closed・§7）。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ byDate: {} });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(startHourMap)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。startHour は時間窓算出と
    // computeBusinessDate の両方で使う。要求 location_id 由来で不変（§9）。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const startHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseRangeTimeRange({ start_date, end_date, start_hour: startHour, end_hour });

    // 同名グループ展開（許可集合との積集合に限定・fail-closed）。
    const { members, warnings } = await resolveSameNameLocationGroup(location_id, { allowedLocationIds });

    // 60 秒予算（vercel.json maxDuration）のため member 間並列は必須（§9）。
    // 1 メンバーでも失敗 → 現行のエラー経路で全体エラー（部分金額を返さない・§4-6）。
    let memberPaymentsList;
    try {
      memberPaymentsList = await Promise.all(
        members.map((member) =>
          fetchAllPayments({ beginTimeJST, endTimeJST, location_id: member.id, token: member.token })
        )
      );
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // COMPLETED 抽出 + 返金正規化（Square Web レポート整合）。concat 後に 1 回適用（§9）。
    const allPayments = normalizePaymentsForReporting(memberPaymentsList.flat());

    // orders / customers / catalog は「その payment が来た token」でのみ取得（token 跨ぎ取得禁止）。
    // メンバー間は並列可・マージは tokenIndex 昇順に代入（後勝ち = 新優先・§9）。
    const perMemberMaps = await Promise.all(
      members.map(async (member, i) => {
        const memberPayments = memberPaymentsList[i];
        const orderIds = [...new Set(memberPayments.filter(p => p.order_id).map(p => p.order_id))];
        const memberOrdersMap = await fetchOrdersBatch(orderIds, member.token);
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

    const byDate = {};

    for (const payment of allPayments) {
      const order = payment.order_id ? ordersMap[payment.order_id] : null;
      const lineItems = (order?.line_items ?? [])
        .filter(item => parseFloat(item.quantity) > 0)
        .map(item => ({
          name: item.name ?? '不明',
          quantity: item.quantity,
          amount: item.gross_sales_money?.amount ?? 0,
          category: variationCategoryMap[item.catalog_object_id]?.name ?? null
        }));

      const tx = {
        id: payment.id,
        created_at_jst: payment.created_at ?? null,
        order_created_at_jst: order?.created_at ?? null,
        amount: payment.amount_money?.amount ?? 0,
        status: payment.status,
        source: payment.source_type ?? 'CARD',
        customer_name: payment.customer_id ? (customersMap[payment.customer_id] ?? null) : null,
        line_items: lineItems,
        discounts: (order?.discounts ?? []).map(d => ({ name: d.name ?? '割引', amount: d.applied_money?.amount ?? 0 }))
      };

      if (!payment.created_at) continue;

      const businessDate = computeBusinessDate(payment.created_at, startHour);
      if (!byDate[businessDate]) {
        byDate[businessDate] = { transactions: [] };
      }
      byDate[businessDate].transactions.push(tx);
    }

    for (const dateKey of Object.keys(byDate)) {
      byDate[dateKey].transactions.sort((a, b) => {
        if (!a.created_at_jst) return 1;
        if (!b.created_at_jst) return -1;
        return new Date(b.created_at_jst).getTime() - new Date(a.created_at_jst).getTime();
      });
    }

    const body = { byDate };
    if (warnings && warnings.length > 0) {
      body.warnings = warnings;
    }

    return res.status(200).json(body);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
