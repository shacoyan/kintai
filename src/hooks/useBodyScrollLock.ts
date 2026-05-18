import { useEffect } from 'react';

/**
 * body / html の overflow を hidden にして背面スクロールを抑止するフック。
 *
 * 設計メモ (2026-05-19 修正):
 * - グローバル参照カウントで複数 Dialog の入れ子に対応。
 * - 最初の lock 時点の overflow を保存する旧実装は、既に他の Dialog が
 *   `overflow: hidden` を残した状態をキャプチャしてしまい、最終 unlock 時に
 *   hidden のまま戻ってしまう「日付タップ後にスクロール不能」バグの原因だった。
 *   現実装ではアプリ側で `body.overflow` を継続的に変更する用途は無い前提とし、
 *   最終 unlock 時は必ず空文字 (= ブラウザ既定) に戻す。
 * - iOS Safari 等で body の overflow のみでは効かないケースがあるため、
 *   `html` 要素 (documentElement) にも同じスタイルを適用する。
 */
let lockCount = 0;

function applyLock(): void {
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
}

function releaseLock(): void {
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    if (lockCount === 0) {
      applyLock();
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        releaseLock();
      }
    };
  }, [active]);
}
