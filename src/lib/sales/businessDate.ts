/**
 * 営業日基準の日付を返す純関数。
 *
 * JST 換算ロジック:
 *   UTC に +9 時間オフセットを加えた JST 相当の Date を構築し、
 *   その年・月・日・時をもとに営業日を判定する。
 *   startHour > 0 のとき、現在 JST 時刻が startHour 未満なら前日扱い (深夜営業対応)。
 *   startHour = 0 (default) のとき、暦日 (JST) と等価。
 *
 * サーバー側 api/_shared.js の computeBusinessDate と同じパターン。
 *
 * 戻り値は 'YYYY-MM-DD' 形式の文字列。
 */
export function getBusinessDate(startHour: number = 0): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const day = jst.getUTCDate();
  const hour = jst.getUTCHours();
  const base = new Date(Date.UTC(y, m, day));
  if (startHour > 0 && hour < startHour) {
    base.setUTCDate(base.getUTCDate() - 1);
  }
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
