import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * URL の searchParams と単一のローカル文字列状態を双方向同期する共有フック。
 *
 * T7（2026-06-18 監査 §2 行80-86「主要な画面状態を searchParams へ同期」）の
 * 横断対処を重複実装なしで横展開するための基盤。HistoryPage / ShiftPage /
 * ProjectsPage / TasksPage / AdminDashboard が各々 inline で書いている
 * 「functional-updater + replace で URL へ書き戻す」パターンを 1 本に集約する。
 *
 * 規律:
 * - **初期値はマウント時 1 回だけ** searchParams.get(key) を読み、allowed に
 *   含まれれば採用、含まれなければ fallback。以後 URL の初期読取はしない
 *   （useState の遅延初期化で固定）。
 * - **書き戻しは必ず functional updater + { replace: true }**。
 *   `setSearchParams((prev) => { const next = new URLSearchParams(prev); ... })`
 *   の形で prev を複製してから set し、他のクエリパラメータを温存する。
 *   オブジェクトリテラル直渡し（`setSearchParams({ key })`）は他クエリを
 *   破壊するため禁止。replace により履歴を汚さない。
 * - 戻る/進む/共有リンクなどで URL 側が変化した場合は allowed 内なら
 *   ローカル state へ反映し、双方向同期を成立させる。
 *
 * @param key       同期する searchParam のキー（例: 'view'）
 * @param allowed   許容する値のタプル（例: ['current', 'history'] as const）
 * @param fallback  allowed に無い／未指定時に採用する既定値
 * @returns [value, setValue] — value は allowed の要素型に推論される
 */
export function useUrlState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // 初期値: マウント時 1 回だけ URL を読む（遅延初期化）。
  const [value, setValue] = useState<T>(() => {
    const raw = searchParams.get(key);
    return raw !== null && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : fallback;
  });

  // ローカル state -> URL: 差分があるときだけ functional updater + replace で書き戻す。
  useEffect(() => {
    if (searchParams.get(key) !== value) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(key, value);
          return next;
        },
        { replace: true },
      );
    }
  }, [key, value, searchParams, setSearchParams]);

  // URL -> ローカル state: 戻る/進む/共有リンクで URL 側が変わり、
  // allowed 内かつローカルと差分があれば反映する。
  useEffect(() => {
    const raw = searchParams.get(key);
    if (
      raw !== null &&
      raw !== value &&
      (allowed as readonly string[]).includes(raw)
    ) {
      setValue(raw as T);
    }
    // allowed はマウント時固定の前提のため依存に含めない（参照同一性で再評価しない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, searchParams]);

  return [value, setValue];
}
