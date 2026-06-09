/**
 * Location color palette and utilities for assigning colors to locations.
 */

/** High-contrast 10-color palette (red/blue/green/amber/purple/teal/orange/pink/lime/gray-800) */
export const LOCATION_COLOR_PALETTE: readonly string[] = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#9333ea',
  '#0891b2',
  '#ea580c',
  '#db2777',
  '#65a30d',
  '#1f2937',
] as const;

/** Color for total/aggregate lines (gray-900) */
export const TOTAL_LINE_COLOR: string = '#111827';

/** Fallback color for locations without a valid ID (gray-500) */
export const FALLBACK_LOCATION_COLOR: string = '#6b7280';

/**
 * Computes the djb2 hash of a string.
 *
 * @param str - The string to hash.
 * @returns The 32-bit signed integer hash value.
 */
function djb2(str: string): number {
  let hash = 5381;

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    hash = ((hash << 5) + hash) + charCode;
    hash = hash & 0xffffffff; // 32-bit mask
  }

  return hash;
}

/**
 * Returns a stable color for a given location ID using the djb2 hash algorithm.
 *
 * @param locationId - The location identifier to hash for color assignment.
 * @param _index - Reserved for future use.
 * @returns A hex color string from the palette, or the fallback color if empty.
 */
export function getLocationColor(locationId: string, _index?: number): string {
  if (locationId === '') {
    return FALLBACK_LOCATION_COLOR;
  }

  const hash = djb2(locationId);
  const stableIndex = Math.abs(hash) % LOCATION_COLOR_PALETTE.length;
  return LOCATION_COLOR_PALETTE[stableIndex];
}

/**
 * Assigns colors to a list of location IDs, ensuring no color collisions
 * within the provided list when the palette size is sufficient.
 *
 * Algorithm:
 * 1. Overrides (if provided) are applied first and marked as used.
 * 2. For each remaining id, djb2 hash determines the desired palette index.
 * 3. If the desired color is already used, shift forward by one and try again
 *    up to `palette.length` times.
 * 4. If the palette is fully consumed (locationIds.length > palette.length),
 *    fall back to the desired index (collision allowed).
 * 5. Empty string ids resolve to FALLBACK_LOCATION_COLOR.
 *
 * @param locationIds - A readonly array of location identifiers.
 * @param overrides - Optional map of location IDs to specific hex color strings.
 *                    Overrides are prioritized and can use colors outside the standard palette.
 * @returns A stable record mapping each provided location ID to a hex color string.
 */
export function getLocationColors(
  locationIds: readonly string[],
  overrides?: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  const palette = LOCATION_COLOR_PALETTE;

  // 1. Apply overrides first (highest priority)
  for (const id of locationIds) {
    const ov = overrides?.[id];
    if (ov) {
      result[id] = ov;
      used.add(ov);
    }
  }

  // 2. Assign colors to remaining ids with collision shift
  for (const id of locationIds) {
    if (result[id]) continue;
    if (id === '') {
      result[id] = FALLBACK_LOCATION_COLOR;
      continue;
    }

    const hash = djb2(id);
    const desired = Math.abs(hash) % palette.length;

    let assigned: string | null = null;
    for (let step = 0; step < palette.length; step++) {
      const cand = palette[(desired + step) % palette.length];
      if (!used.has(cand)) {
        assigned = cand;
        break;
      }
    }
    // Palette fully consumed: allow collision by using the desired index
    if (assigned === null) assigned = palette[desired];

    result[id] = assigned;
    used.add(assigned);
  }

  return result;
}
