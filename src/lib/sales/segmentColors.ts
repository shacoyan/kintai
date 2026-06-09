// tailwind.config.js の theme.extend.colors.accent.segment と完全同期させること

import type { CustomerSegment } from './types';

export const segmentColors: Record<CustomerSegment, string> = {
  new: '#3b82f6',
  repeat: '#eab308',
  regular: '#ef4444',
  staff: '#a855f7',
  unlisted: '#6b7280',
};

export const segmentEmptyColor = '#d1d5db';
