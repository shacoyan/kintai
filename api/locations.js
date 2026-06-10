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
 */

import { setCors, squareHeaders } from './_shared.js';
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

    const response = await fetch('https://connect.squareup.com/v2/locations', {
      method: 'GET',
      headers: squareHeaders(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Square API error:', response.status, errorBody);
      return res.status(response.status).json({ error: 'Failed to fetch locations from Square API' });
    }

    const data = await response.json();

    const allowedSet = new Set(allowedLocationIds);
    const locations = (data.locations || [])
      .filter(loc => allowedSet.has(loc.id))
      .map(loc => ({
        id: loc.id,
        name: loc.name,
        business_day_start_hour: resolveStartHour(startHourMap, loc.id),
      }));

    return res.status(200).json({ locations });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error fetching locations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
