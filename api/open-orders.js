import { setCors, squareHeaders, parseTimeRange, fetchCustomers, isValidDateStr } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

export default async (req, res) => {
  if (setCors(req, res)) {
    return res.status(200).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // JWT から許可 location 集合 + 店舗別 start_hour を解決（fail-closed: 無権限は AuthError→401）。
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    const { location_id, date, end_hour } = req.query;
    if (!location_id) return res.status(400).json({ error: 'location_id is required' });
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'date must be valid YYYY-MM-DD' });
    }

    // 越権封鎖: 許可外 location は存在を漏らさず空返し。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ orders: [] });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(locations_meta)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const resolvedStartHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseTimeRange({ date, start_hour: resolvedStartHour, end_hour });

    // cursor ページング: limit=50 単発だと 51件以上の OPEN 注文が切り捨てられる。
    // cursor を辿って全件取得する（暴走防止に最大 200 ページ＝1万件上限）。
    let rawOrders = [];
    let cursor = undefined;
    let pages = 0;

    do {
      if (++pages > 200) {
        console.error('open-orders.js pagination runaway (>200 pages)');
        return res.status(502).json({ error: 'Square API error' });
      }

      const response = await fetch('https://connect.squareup.com/v2/orders/search', {
        method: 'POST',
        headers: squareHeaders(),
        body: JSON.stringify({
          location_ids: [location_id],
          query: {
            filter: {
              state_filter: { states: ['OPEN'] },
              date_time_filter: { created_at: { start_at: beginTimeJST, end_at: endTimeJST } }
            },
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
          },
          limit: 200,
          cursor: cursor
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Square API error (open-orders):', response.status, err);
        return res.status(response.status).json({ error: 'Square API error' });
      }

      const data = await response.json();
      rawOrders = rawOrders.concat(data.orders ?? []);
      cursor = data.cursor ?? undefined;
    } while (cursor);

    // customers bulk-retrieve
    const customerIds = rawOrders.filter(o => o.customer_id).map(o => o.customer_id);
    const customersMap = await fetchCustomers(customerIds);

    const orders = rawOrders.map(order => ({
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
    }));

    return res.status(200).json({ orders });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching open orders:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
