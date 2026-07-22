/**
 * api/locations.js
 * スコープ解決済 location 一覧（id / name / business_day_start_hour）。
 *
 * 見本 square-dashboard/api/locations.js から移植。改変点:
 *   - validateToken（storeLabel name filter）→ _auth.js authenticate（Bearer JWT スコープ）。
 *   - Square /v2/locations を全件取得し、authenticate の allowedLocationIds に
 *     含まれる id のみ返す（フロント制御は信用せずサーバで最終強制）。
 *   - business_day_start_hour は _auth.js の startHourMap から resolveStartHour で解決。
 *   - 返す形: { locations: [{ id, name, business_day_start_hour }] }。
 *
 * Phase 2（2026-07-22 デュアルトークン合算・設計書§8）:
 *   - 単発 fetch → fetchAllLocationsMulti()（全トークン合算・fail-soft）に置換。
 *   - allowedSet filter（現行の順序を維持）を dedupeLocationsByName より前に実行
 *     （許可外店舗の名寄せに巻き込まれない）。
 *   - 全トークン失敗時は 502（upstream_status は省略 = §10 宣言差分 2。error 全文は console.error）。
 *   - 片トークン失敗時は解決できた側のみで一覧を返し、warnings が非空の時のみ body に追加する。
 */

import { setCors, fetchAllLocationsMulti, dedupeLocationsByName } from './_shared.js';
import { authenticate, resolveStartHour, AuthError } from './_auth.js';

export default async (req, res) => {
  if (setCors(req, res)) {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { allowedLocationIds, startHourMap } = await authenticate(req);

    let locations, tokenSummary;
    try {
      ({ locations, tokenSummary } = await fetchAllLocationsMulti());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Square API error (all tokens failed):', errorMessage);
      return res.status(502).json({ error: 'Failed to fetch locations from Square API' });
    }

    const allowedSet = new Set(allowedLocationIds);
    const deduped = dedupeLocationsByName(locations.filter(loc => allowedSet.has(loc.id)));

    const responseLocations = deduped.map(loc => ({
      id: loc.id,
      name: loc.name,
      business_day_start_hour: resolveStartHour(startHourMap, loc.id),
    }));

    const warnings = tokenSummary
      .filter(t => !t.ok)
      .map(t => ({
        type: 'token_locations_failed',
        token_index: t.token_index,
        env_key: t.env_key,
        error: t.error,
      }));

    const body = { locations: responseLocations };
    if (warnings.length > 0) body.warnings = warnings;

    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching locations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
