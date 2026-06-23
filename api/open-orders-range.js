import { parseRangeTimeRange, computeBusinessDate, fetchCustomers, setCors, squareHeaders, isValidDateStr, rangeDays } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

// open-orders（未会計）の取得は live ダッシュボード用途のみ。acquisition live の clamp が
// 約 3 ヶ月＝92 日相当なので、それに整合させて業務上限を 92 日に絞る（共用の
// MAX_RANGE_DAYS=366 は transactions-range 等が使うため _shared.js 側は変更しない）。
const OPEN_ORDERS_MAX_DAYS = 92;

export default async (req, res) => {
  if (setCors(req, res)) {
    return res.status(200).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // JWT から許可 location 集合 + 店舗別 start_hour を解決（fail-closed: 無権限は AuthError→401）。
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    const { start_date, end_date, location_id, end_hour } = req.query;
    if (!location_id) return res.status(400).json({ error: 'location_id is required' });
    if (!start_date) return res.status(400).json({ error: 'start_date is required' });
    if (!end_date) return res.status(400).json({ error: 'end_date is required' });

    if (!isValidDateStr(start_date) || !isValidDateStr(end_date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'start_date / end_date must be valid YYYY-MM-DD' });
    }

    if (start_date > end_date) {
      return res.status(400).json({ error: 'invalid_date_range', message: 'start_date must be <= end_date' });
    }

    if (rangeDays(start_date, end_date) > OPEN_ORDERS_MAX_DAYS) {
      return res.status(400).json({ error: 'range_too_large', message: `date range must be <= ${OPEN_ORDERS_MAX_DAYS} days` });
    }

    // 越権封鎖: 許可外 location は存在を漏らさず空返し。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ byDate: {} });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(locations_meta)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。startHourNum は時間窓算出と
    // computeBusinessDate の両方で使う。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const startHourNum = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseRangeTimeRange({ start_date, end_date, start_hour: startHourNum, end_hour });

    let rawOrders = [];
    let cursor = undefined;
    let pages = 0;

    do {
      if (++pages > 1000) {
        console.error('open-orders-range.js pagination runaway (>1000 pages)');
        return res.status(502).json({ error: 'Square API error' });
      }
      // cursor ページングは直列維持（次 cursor が前レスポンス依存）。タイムアウトのみ付与し
      // 無限待ちを防ぐ。タイムアウト（AbortError）は致命パスとして外側 catch で 500 化される。
      const response = await fetch('https://connect.squareup.com/v2/orders/search', {
        method: 'POST',
        headers: squareHeaders(),
        signal: AbortSignal.timeout(9000),
        body: JSON.stringify({
          location_ids: [location_id],
          query: {
            filter: {
              state_filter: { states: ['OPEN'] },
              date_time_filter: { created_at: { start_at: beginTimeJST, end_at: endTimeJST } }
            },
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
          },
          limit: 500,
          cursor: cursor
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Square API error (open-orders-range):', response.status, err);
        return res.status(502).json({ error: 'Square API error', upstream_status: response.status });
      }

      const data = await response.json();
      rawOrders = rawOrders.concat(data.orders ?? []);
      cursor = data.cursor ?? undefined;
    } while (cursor);

    // customers bulk-retrieve
    const customerIds = rawOrders.filter(o => o.customer_id).map(o => o.customer_id);
    const customersMap = await fetchCustomers(customerIds);

    // Business Date Grouping
    const byDate = {};

    rawOrders.forEach(order => {
      const businessDate = computeBusinessDate(order.created_at, startHourNum);

      const formattedOrder = {
        id: order.id,
        created_at: order.created_at ?? null,
        total_money: order.total_money?.amount ?? 0,
        customer_name: order.customer_id ? (customersMap[order.customer_id] ?? null) : null,
        line_items: (order.line_items ?? [])
          .filter(item => parseFloat(item.quantity) > 0)
          .map(item => ({
            name: item.name ?? '不明',
            quantity: item.quantity,
            amount: item.gross_sales_money?.amount ?? 0
          })),
        discounts: (order.discounts ?? []).map(d => ({
          name: d.name ?? '割引',
          amount: d.applied_money?.amount ?? 0
        }))
      };

      if (!byDate[businessDate]) {
        byDate[businessDate] = { orders: [] };
      }
      byDate[businessDate].orders.push(formattedOrder);
    });

    return res.status(200).json({ byDate });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching open orders range:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
