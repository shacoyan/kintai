/**
 * L19: transition 共通化
 *
 * Tailwind の transition クラスを目的別に集約する。
 * `cn(MOTION.fast, ...)` または `${MOTION.fast} ...` 形式で利用する。
 *
 * 設計指針 (L19 §4.2):
 * - color (hover/focus): 150ms ease-out (速やかな応答)
 * - transform (chevron 回転等): 200ms ease-out (視認性確保)
 * - opacity (fade-in): 200ms ease-out
 *
 * `as const` で literal 型として export し、参照側の typo を tsc で検出する。
 */
export const MOTION = {
  /** 色変化 (hover / focus) - 速やかな応答 */
  fast: 'transition-colors duration-150 ease-out',
  /** transform 変化 (chevron 回転、translate) - 視認性確保 */
  transform: 'transition-transform duration-200 ease-out',
  /** opacity 変化 (fade-in) */
  fade: 'transition-opacity duration-200 ease-out',
} as const;
