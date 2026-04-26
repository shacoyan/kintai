/**
 * Minimal class joiner helper (clsx 相当の最小実装、依存ゼロ)
 * Phase 1 (2026-04-26 UX Loop) で導入。全 ui/* コンポーネントで利用。
 */
export function cn(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ');
}
