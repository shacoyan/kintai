/** japanese-holidays npm の型定義 (Loop 44) — 公式型未提供のための ambient module 宣言。 */
declare module 'japanese-holidays' {
  /**
   * 指定日が日本の国民の祝日であれば祝日名 (例: "憲法記念日") を返し、
   * 祝日でなければ undefined を返す。
   */
  export function isHoliday(date: Date): string | undefined;

  /** 指定年の全祝日リスト。 */
  export function getHolidaysOf(
    year: number,
    furikae?: boolean
  ): Array<{ month: number; date: number; name: string }>;
}
