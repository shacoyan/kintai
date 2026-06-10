import { setCors, squareHeaders, parseTimeRange, fetchCustomers, normalizePaymentsForReporting } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

// maxDuration は vercel.json の functions に一本化（inline config と二重定義していたため撤去）。

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

    // 越権ガード: 要求 location_id が許可集合に無ければ空配列を返す（存在を漏らさない・§2.2）。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({ transactions: [] });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(startHourMap)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const resolvedStartHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseTimeRange({ date, start_hour: resolvedStartHour, end_hour });

    let allPayments = [];
    let cursor = undefined;

    do {
      let url = `https://connect.squareup.com/v2/payments?begin_time=${encodeURIComponent(beginTimeJST)}&end_time=${encodeURIComponent(endTimeJST)}&location_id=${encodeURIComponent(location_id)}&limit=200`;

      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: squareHeaders()
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Square API error:', response.status, errorBody);
        return res.status(response.status).json({ error: 'Failed to fetch payments from Square API', detail: errorBody });
      }

      const data = await response.json();

      if (data.payments) {
        allPayments = allPayments.concat(data.payments);
      }

      cursor = data.cursor || undefined;
    } while (cursor);

    // COMPLETED 抽出 + 返金正規化（Square Web レポート整合）
    allPayments = normalizePaymentsForReporting(allPayments);

    // orders batch-retrieve
    const orderIds = [...new Set(
      allPayments.filter(p => p.order_id).map(p => p.order_id)
    )];

    const ordersMap = {};
    for (let i = 0; i < orderIds.length; i += 100) {
      const batch = orderIds.slice(i, i + 100);
      try {
        const orderRes = await fetch('https://connect.squareup.com/v2/orders/batch-retrieve', {
          method: 'POST',
          headers: squareHeaders(),
          body: JSON.stringify({ order_ids: batch })
        });
        if (orderRes.ok) {
          const orderData = await orderRes.json();
          for (const order of (orderData.orders ?? [])) {
            ordersMap[order.id] = order;
          }
        }
      } catch (e) {
        // batch失敗しても続行
      }
    }

    // catalog取得とcustomers取得を並列実行
    const [customersMap, variationCategoryMap] = await Promise.all([
      // customers bulk-retrieve
      (async () => {
        const customerIds = allPayments.filter(p => p.customer_id).map(p => p.customer_id);
        return await fetchCustomers(customerIds);
      })(),

      // catalog batch-retrieve (カテゴリ取得) - 2段階方式
      (async () => {
        const catalogObjectIds = [...new Set(
          Object.values(ordersMap).flatMap(order =>
            (order.line_items ?? [])
              .filter(item => parseFloat(item.quantity) > 0 && item.catalog_object_id)
              .map(item => item.catalog_object_id)
          )
        )];

        const variationToItemId = {};
        const itemToCategoryId = {};

        // 第1段階: ITEM_VARIATIONとITEMを取得
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

        // 第2段階: CATEGORYを取得
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

        // 最終マップ構築: variationId → categoryName
        const localVariationCategoryMap = {};
        for (const [varId, itemId] of Object.entries(variationToItemId)) {
          if (!itemId) { localVariationCategoryMap[varId] = null; continue; }
          const catId = itemToCategoryId[itemId];
          localVariationCategoryMap[varId] = catId ? (categoryIdToName[catId] ?? null) : null;
        }

        return localVariationCategoryMap;
      })()
    ]);

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

    return res.status(200).json({ transactions });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching transactions:', error);
    return res.status(500).json({ error: 'Internal server error', detail: String(error?.message ?? error) });
  }
};
