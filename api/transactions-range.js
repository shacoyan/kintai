import { setCors, parseRangeTimeRange, computeBusinessDate, fetchAllPayments, fetchOrdersBatch, fetchCatalogVariationCategoryMap, fetchCustomers, normalizePaymentsForReporting, isValidDateStr, rangeDays, MAX_RANGE_DAYS } from './_shared.js';
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
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ byDate: {} });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(startHourMap)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。startHour は時間窓算出と
    // computeBusinessDate の両方で使う。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const startHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseRangeTimeRange({ start_date, end_date, start_hour: startHour, end_hour });
    const allPayments0 = await fetchAllPayments({ beginTimeJST, endTimeJST, location_id });

    // COMPLETED 抽出 + 返金正規化（Square Web レポート整合）
    const allPayments = normalizePaymentsForReporting(allPayments0);

    const orderIds = [...new Set(allPayments.filter(p => p.order_id).map(p => p.order_id))];
    const ordersMap = await fetchOrdersBatch(orderIds);

    const customerIds = allPayments.filter(p => p.customer_id).map(p => p.customer_id);

    const [customersMap, variationCategoryMap] = await Promise.all([
      fetchCustomers(customerIds),
      fetchCatalogVariationCategoryMap(ordersMap)
    ]);

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

    return res.status(200).json({ byDate });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
