import { setCors, squareHeaders, parseTimeRange, normalizePaymentsForReporting, isValidDateStr, resolveSameNameLocationGroup } from './_shared.js';
import { authenticate, resolveStartHour, assertLocationAllowed, AuthError } from './_auth.js';

/**
 * 1 member（= 1 Square アカウント配下の location_id）分の payments を全ページ取得する。
 * 失敗時は Error を throw し、Square 非 ok レスポンスは err.upstreamStatus を付与する
 * （呼び出し側で 502 + upstream_status に変換。§9 の「部分合算禁止・最初の失敗で全体エラー」）。
 */
async function fetchMemberPayments(member, beginTimeJST, endTimeJST) {
  let allPayments = [];
  let cursor = undefined;
  let pages = 0;

  do {
    if (++pages > 1000) {
      console.error('sales.js pagination runaway (>1000 pages)');
      throw new Error('sales.js pagination runaway (>1000 pages)');
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
      allPayments = allPayments.concat(data.payments);
    }

    cursor = data.cursor || undefined;
  } while (cursor);

  return allPayments;
}

export default async (req, res) => {
  if (setCors(req, res)) {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // JWT 検証 + スコープ解決（get_allowed_location_ids）。service role 不使用。
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    const { date, location_id, end_hour } = req.query;

    if (!date || !location_id) {
      return res.status(400).json({ error: 'date and location_id are required' });
    }

    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'date must be valid YYYY-MM-DD' });
    }

    // 越権ガード: 要求 location_id が許可集合に無ければ、存在を漏らさず空データを返す（§2.2）。
    // 同名グループ展開はこのガードより後にのみ行う（許可外リクエストは展開ロジック・Square API に到達しない）。
    if (!assertLocationAllowed(allowedLocationIds, location_id)) {
      return res.status(200).json({
        total_amount: 0,
        transaction_count: 0,
        currency: 'JPY'
      });
    }

    // start_hour（営業日の日付変更線）はサーバ正本(locations_meta / startHourMap)から店舗別に解決する。
    // 後方互換: query で明示された 0-23 の値があればそれを優先（backfill/retry 用）。
    const qsh = req.query.start_hour;
    const parsedQsh = qsh !== undefined ? parseInt(qsh, 10) : NaN;
    const resolvedStartHour = (!Number.isNaN(parsedQsh) && parsedQsh >= 0 && parsedQsh <= 23)
      ? parsedQsh
      : resolveStartHour(startHourMap, location_id);

    const { beginTimeJST, endTimeJST } = parseTimeRange({ date, start_hour: resolvedStartHour, end_hour });

    // 同名グループ展開（デュアルトークン合算）。members は要求 id を必ず含み、許可集合との積集合に限定される。
    const { members, warnings } = await resolveSameNameLocationGroup(location_id, { allowedLocationIds });

    let paymentsByMember;
    try {
      paymentsByMember = await Promise.all(
        members.map(member => fetchMemberPayments(member, beginTimeJST, endTimeJST))
      );
    } catch (error) {
      if (error && typeof error.upstreamStatus === 'number') {
        return res.status(502).json({ error: 'Failed to fetch payments from Square API', upstream_status: error.upstreamStatus });
      }
      console.error('Error fetching sales:', error);
      return res.status(502).json({ error: 'Failed to fetch payments from Square API' });
    }

    let allPayments = paymentsByMember.flat();
    allPayments = normalizePaymentsForReporting(allPayments);

    let totalAmount = 0;
    let transactionCount = 0;

    for (const payment of allPayments) {
      totalAmount += payment.amount_money?.amount ?? 0;
      transactionCount++;
    }

    const body = {
      total_amount: totalAmount,
      transaction_count: transactionCount,
      currency: 'JPY'
    };
    if (warnings && warnings.length > 0) {
      body.warnings = warnings;
    }

    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching sales:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
