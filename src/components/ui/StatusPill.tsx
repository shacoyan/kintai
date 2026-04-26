import { Badge, type BadgeProps } from './Badge';

export type StatusPillProps = Omit<BadgeProps, 'withDot'>;

/**
 * StatusPill — ステータス表示のセマンティクス専用ラッパ。
 * Badge withDot を内部で常に付け、「色 + ドット/アイコン + テキスト」の
 * 三要素で状態を伝える（絵文字代替）。色覚配慮のため tone と icon を併用すること。
 */
export function StatusPill(props: StatusPillProps): JSX.Element {
  return <Badge withDot {...props} />;
}
