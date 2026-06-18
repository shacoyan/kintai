// kintai/src/lib/focusable.ts

// 各セレクタに aria-hidden="true" 除外を付与 (P3-16)。
// セレクタ自身が aria-hidden な要素は除外するが、これだけでは
// 「祖先が aria-hidden / inert」のケースを取りこぼすため、
// getFocusable() で実行時の祖先フィルタを併用する。
const FOCUSABLE_NOT_HIDDEN = ':not([aria-hidden="true"])';

export const FOCUSABLE_SELECTOR: string = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  'details > summary:first-of-type',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((sel) => `${sel}${FOCUSABLE_NOT_HIDDEN}`)
  .join(', ');

// inert / aria-hidden="true" な祖先配下の要素は、たとえ自身がフォーカス可能でも
// 実際にはフォーカスできない (inert) / 支援技術から隠される (aria-hidden)。
// CSS の :not() では祖先方向を辿れないため、closest() で実行時に除外する。
const INERT_OR_HIDDEN_ANCESTOR = '[inert], [aria-hidden="true"]';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.closest(INERT_OR_HIDDEN_ANCESTOR) === null);
}
