/**
 * @fileoverview シフト希望タイプ（preferred / unavailable）ごとのテーマ定義。
 * アイコン・色・ラベル・Tailwind クラスを一元管理し、UI 全体で一貫したスタイルを提供する。
 */

import type { LucideIcon } from 'lucide-react';
import { Star, Ban } from 'lucide-react';
import type { ShiftPreferenceType } from '../types';

/** テーマの色調を表す型 */
export type PreferenceTone = 'primary' | 'neutral';

/** シフト希望タイプに紐づくテーマ情報 */
export interface PreferenceTheme {
  type: ShiftPreferenceType;
  tone: PreferenceTone;
  label: string;
  shortLabel: string;
  description: string;
  Icon: LucideIcon;
  cellClass: string;
  countTextClass: string;
  dotClass: string;
  iconColorClass: string;
  iconBoxClass: string;
  cardBorderBgClass: string;
  badgeClass: string;
}

/** 希望タイプごとのテーママッピング */
export const PREFERENCE_THEME: Record<ShiftPreferenceType, PreferenceTheme> = {
  preferred: {
    type: 'preferred',
    tone: 'primary',
    label: '希望',
    shortLabel: '希',
    description: '希望して入りたい日',
    Icon: Star,
    cellClass:
      'bg-blue-50 ring-1 ring-blue-200 text-blue-700 dark:bg-blue-800/30 dark:ring-blue-700 dark:text-blue-100',
    countTextClass: 'text-blue-600 dark:text-blue-400',
    dotClass: 'bg-blue-500 dark:bg-blue-400',
    iconColorClass: 'text-blue-500 dark:text-blue-400',
    iconBoxClass:
      'bg-blue-50 text-blue-700 dark:bg-blue-800/40 dark:text-blue-200',
    cardBorderBgClass:
      'border-blue-100 bg-blue-50 dark:border-blue-700 dark:bg-blue-900',
    badgeClass:
      'bg-blue-50 text-blue-700 dark:bg-blue-700 dark:text-blue-100',
  },
  unavailable: {
    type: 'unavailable',
    tone: 'neutral',
    label: '出勤不可',
    shortLabel: '不',
    description: '出勤できない日',
    Icon: Ban,
    cellClass:
      'bg-stone-50 ring-1 ring-stone-300 text-stone-700 dark:bg-stone-900/30 dark:ring-stone-700 dark:text-stone-200',
    countTextClass: 'text-stone-600 dark:text-stone-300',
    dotClass: 'bg-stone-500 dark:bg-stone-400',
    iconColorClass: 'text-stone-500 dark:text-stone-300',
    iconBoxClass:
      'bg-stone-50 text-stone-700 dark:bg-stone-900/40 dark:text-stone-300',
    cardBorderBgClass:
      'border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-950',
    badgeClass:
      'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  },
};

/** テーマを順序付き配列として取得する（preferred → unavailable） */
export const PREFERENCE_THEME_LIST: PreferenceTheme[] = [
  PREFERENCE_THEME.preferred,
  PREFERENCE_THEME.unavailable,
];

/**
 * 指定した希望タイプのテーマを取得する純関数。
 *
 * 想定外の値（旧 bundle 残留や DB 流入の `available` 等）を受けた場合は
 * `'preferred'` テーマへ fallback し、開発環境でのみ警告を出す。
 * SW キャッシュ bump（v3）と二重防御の関係で、過渡期の表示クラッシュを
 * 防ぐための idempotent な救済処理。
 */
export function getPreferenceTheme(type: ShiftPreferenceType): PreferenceTheme {
  const theme = PREFERENCE_THEME[type];
  if (theme) return theme;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[preferenceTheme] unknown preference_type: ${String(type)}, falling back to 'preferred'`,
    );
  }
  return PREFERENCE_THEME.preferred;
}
