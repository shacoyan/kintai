/**
 * 1ヶ月分 E2E テスト共通セレクタ集約。
 *
 * 画面側の DOM 構造変更が起きた場合、ここを更新するだけで Team B/C の spec が追従できるよう、
 * role / aria-label / id を中心に集約する。text 完全一致への依存は最小化する。
 *
 * @see kintai/src/components/Shift/ShiftPreferenceForm.tsx
 * @see kintai/src/components/Shift/ShiftPreferenceCalendar.tsx
 * @see kintai/src/components/Shift/PreferenceActionRow.tsx
 */

/** ログイン画面 */
export const LOGIN = {
  emailInput: { role: 'textbox' as const, name: 'メールアドレス' },
  passwordInput: { role: 'textbox' as const, name: 'パスワード' },
  submitButton: { role: 'button' as const, name: 'ログイン', exact: true },
};

/** カレンダー (希望提出 + 承認共通) */
export const CALENDAR = {
  /** カレンダー grid (role=grid, aria-label="シフト申請カレンダー") */
  grid: { role: 'grid' as const, name: 'シフト申請カレンダー' },
  prevMonthButton: { role: 'button' as const, name: '前月' },
  nextMonthButton: { role: 'button' as const, name: '次月' },
  /** 月見出し例: "2026年5月" — `tabular-nums` クラスのテキストにマッチ */
  monthHeadingPattern: /(\d{4})年(\d+)月/,
  /**
   * 日付セル (self/admin 共通): role=gridcell, aria-label が "2026年5月1日 (金)" 形式で始まる。
   * 曜日を含めずに startsWith マッチで使うこと。
   */
  cellAriaLabelPrefix: (year: number, month: number, day: number) =>
    `${year}年${month}月${day}日`,
};

/** ShiftPreferenceForm (BottomSheet 内) */
export const PREF_FORM = {
  typeButtonId: (type: 'preferred' | 'available' | 'unavailable') =>
    `pref-type-${type}-btn`,
  storeSelect: { label: '店舗', exact: true },
  startTimeSelect: { label: '開始時刻', exact: true },
  endTimeSelect: { label: '終了時刻', exact: true },
  /** 新規 = "登録する" / 既存上書き = "上書きする" */
  submitButton: { role: 'button' as const, namePattern: /登録する|上書きする/ },
  /** 深夜跨ぎ NG メッセージ (validateTimeRange 由来) */
  invalidRangeMessage: '終了は開始より後にしてください（夜勤跨ぎは未対応）',
};

/** PreferenceActionRow (full variant: 詳細 BottomSheet 内) */
export const PREF_ACTION_ROW = {
  approveButton: { role: 'button' as const, name: '承認', exact: true },
  approveConfirmButton: { role: 'button' as const, name: '承認する', exact: true },
  rejectButton: { role: 'button' as const, name: '却下', exact: true },
  rejectConfirmButton: { role: 'button' as const, name: '却下する', exact: true },
  approvedBadgeText: '承認済',
};

/** ダイアログ / BottomSheet */
export const DIALOG = {
  byRole: { role: 'dialog' as const },
};

/** Admin 切替トグル (全員表示) */
export const ADMIN = {
  allMembersToggle: { role: 'button' as const, name: '全員のシフト申請', exact: true },
};

/** 検証対象画面 */
export const ROUTES = {
  login: '/login',
  tenant: '/tenant',
  shift: '/shift',
  shiftPreferenceTab: '/shift?tab=preference',
  shiftTab: '/shift?tab=shift',
};

/** 既知 noise (reporter 側で info に格下げ) */
export const CONSOLE_NOISE = [
  /\[Vite\] hmr update/,
  /Encountered two children with the same key/,
  /GoTrueClient/,
];
