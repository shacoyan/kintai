/**
 * @fileoverview シフト希望タイプ（preferred / available / unavailable）ごとのテーマ定義。
 * アイコン・色・ラベル・Tailwind クラスを一元管理し、UI 全体で一貫したスタイルを提供する。
 */

import type { LucideIcon } from 'lucide-react';
import { Star, CheckCircle2, Ban } from 'lucide-react';
import type { ShiftPreferenceType } from '../types';

/** テーマの色調を表す型 */
export type PreferenceTone = 'primary' | 'success' | 'neutral';

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
      'bg-primary-50 ring-1 ring-primary-300 text-primary-700 dark:bg-primary-900/30 dark:ring-primary-700 dark:text-primary-200',
    countTextClass: 'text-primary-600 dark:text-primary-400',
    dotClass: 'bg-primary-500 dark:bg-primary-400',
    iconColorClass: 'text-primary-500 dark:text-primary-400',
    iconBoxClass:
      'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
    cardBorderBgClass:
      'border-primary-200 bg-primary-50 dark:border-primary-700 dark:bg-primary-950',
    badgeClass:
      'bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-primary-200',
  },
  available: {
    type: 'available',
    tone: 'success',
    label: '出勤可能',
    shortLabel: '可',
    description: '出勤可能 (調整OK)',
    Icon: CheckCircle2,
    cellClass:
      'bg-success-50 ring-1 ring-success-300 text-success-700 dark:bg-success-900/30 dark:ring-success-700 dark:text-success-200',
    countTextClass: 'text-success-600 dark:text-success-400',
    dotClass: 'bg-success-500 dark:bg-success-400',
    iconColorClass: 'text-success-500 dark:text-success-400',
    iconBoxClass:
      'bg-success-50 text-success-700 dark:bg-success-900/40 dark:text-success-300',
    cardBorderBgClass:
      'border-success-200 bg-success-50 dark:border-success-700 dark:bg-success-950',
    badgeClass:
      'bg-success-100 text-success-700 dark:bg-success-800 dark:text-success-200',
  },
  unavailable: {
    type: 'unavailable',
    tone: 'neutral',
    label: '出勤不可',
    shortLabel: '不',
    description: '出勤できない日',
    Icon: Ban,
    cellClass:
      'bg-neutral-50 ring-1 ring-neutral-300 text-neutral-700 dark:bg-neutral-900/30 dark:ring-neutral-700 dark:text-neutral-200',
    countTextClass: 'text-neutral-600 dark:text-neutral-300',
    dotClass: 'bg-neutral-500 dark:bg-neutral-400',
    iconColorClass: 'text-neutral-500 dark:text-neutral-300',
    iconBoxClass:
      'bg-neutral-50 text-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-300',
    cardBorderBgClass:
      'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950',
    badgeClass:
      'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  },
};

/** テーマを順序付き配列として取得する（preferred → available → unavailable） */
export const PREFERENCE_THEME_LIST: PreferenceTheme[] = [
  PREFERENCE_THEME.preferred,
  PREFERENCE_THEME.available,
  PREFERENCE_THEME.unavailable,
];

/** 指定した希望タイプのテーマを取得する純関数 */
export function getPreferenceTheme(type: ShiftPreferenceType): PreferenceTheme {
  return PREFERENCE_THEME[type];
}
