import type { ShiftPreferenceType } from '../../src/types';

/**
 * 1ヶ月分 E2E テストで使用するシフト仕様。
 *
 * @see ../../.company/engineering/docs/2026-05-07-kintai-1month-shift-e2e-techdesign.md (§6.3)
 */
export interface ShiftSpec {
  /** スタッフを示す環境変数プレフィックス (E2E_USER_<staffEnv>_EMAIL / _PASSWORD) */
  staffEnv: 'TEST04' | 'TEST05' | 'TEST06';
  /** 店舗 ID 環境変数キー (UI では storeName で selectOption するため id は補助情報) */
  storeIdEnv: 'E2E_STORE_HONTEN_ID' | 'E2E_STORE_BUNTEN_ID';
  /** 店舗 select に表示される label テキスト (selectOption({ label: storeName })) */
  storeName: 'テスト本店' | 'テスト分店';
  /** 希望タイプ (現状 1month テストでは preferred のみ使用) */
  preferenceType: ShiftPreferenceType;
  /** 開始時刻 'HH:MM' (15 分刻み select option) */
  startTime: string;
  /** 終了時刻 'HH:MM' (15 分刻み select option) */
  endTime: string;
  /** 備考 (任意) */
  note?: string;
}

/**
 * 3 スタッフ × 31 日 = 93 件のテンプレ。
 * - TEST04: 本店 13:00-21:00 (通常昼〜夕方)
 * - TEST05: 本店 21:00-05:00 (深夜跨ぎ。#65 で許容済のためそのまま提出)
 * - TEST06: 分店 17:00-22:00 (夕方〜夜)
 */
export const SHIFT_TEMPLATE: readonly ShiftSpec[] = [
  {
    staffEnv: 'TEST04',
    storeIdEnv: 'E2E_STORE_HONTEN_ID',
    storeName: 'テスト本店',
    preferenceType: 'preferred',
    startTime: '13:00',
    endTime: '21:00',
  },
  {
    staffEnv: 'TEST05',
    storeIdEnv: 'E2E_STORE_HONTEN_ID',
    storeName: 'テスト本店',
    preferenceType: 'preferred',
    startTime: '21:00',
    endTime: '05:00',
  },
  {
    staffEnv: 'TEST06',
    storeIdEnv: 'E2E_STORE_BUNTEN_ID',
    storeName: 'テスト分店',
    preferenceType: 'preferred',
    startTime: '17:00',
    endTime: '22:00',
  },
];

/**
 * 2026-05-01 〜 2026-05-31 を 'YYYY-MM-DD' 形式で 31 件生成する。
 */
function generateDateRange(year: number, month: number): string[] {
  const dates: string[] = [];
  // month は 1-12、Date 構築は month-1
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

/** 2026-05-01 〜 2026-05-31 の 31 日分日付文字列 */
export const TEST_DATES_2026_05: readonly string[] = generateDateRange(2026, 5);
