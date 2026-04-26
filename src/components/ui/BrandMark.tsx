/**
 * BrandMark — 4分割マーク（kintai 共通ブランドマーク）
 *
 * Phase 2 / Blocker B3 で導入。
 * プロト `01-login.html` の `<svg viewBox="0 0 18 18">` 4分割マークを
 * 共通コンポーネント化したもの。
 *
 * 想定利用箇所:
 *  - LoginPage（モバイルロゴ・PCヒーローロゴ）
 *  - Sidebar（ヘッダ）
 *  - MobileHeader
 */

export type BrandMarkSize = 'sm' | 'md' | 'lg';

export interface BrandMarkProps {
  /** マーク本体の表示サイズ（px）。sm=16 / md=20 / lg=32。default: 'md' */
  size?: BrandMarkSize;
  /** 4矩形の塗り色（CSS color）。default: 'currentColor'（親の text-* 色を継承） */
  color?: string;
  /** 追加クラス（コンテナ用ではなく svg 要素に付与） */
  className?: string;
  /** スクリーンリーダー向けラベル。指定時は role="img"+aria-label、未指定時は aria-hidden */
  title?: string;
}

const SIZE_PX: Record<BrandMarkSize, number> = {
  sm: 16,
  md: 20,
  lg: 32,
};

export function BrandMark({
  size = 'md',
  color = 'currentColor',
  className,
  title,
}: BrandMarkProps) {
  const px = SIZE_PX[size];
  const labelled = typeof title === 'string' && title.length > 0;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 18 18"
      fill="none"
      className={className}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <rect x="2" y="2" width="6" height="6" rx="1" fill={color} />
      <rect x="10" y="2" width="6" height="6" rx="1" fill={color} opacity="0.5" />
      <rect x="2" y="10" width="6" height="6" rx="1" fill={color} opacity="0.5" />
      <rect x="10" y="10" width="6" height="6" rx="1" fill={color} />
    </svg>
  );
}
