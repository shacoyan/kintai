/**
 * kintai i18n messages catalog
 *
 * Loop 43 で dot-notation キー前提に整理 (本格 i18next 移行は Loop 44+)。
 * 各セクション (empty/toast/error/validation/confirm) はそのまま i18n namespace に対応する。
 *
 * 抽出規則:
 *   `messages.empty.attendanceMonth.title` -> i18n key: `empty.attendanceMonth.title`
 *   `messages.toast.saved(x)` -> i18n key: `toast.saved` (パラメータ {target})
 *   `messages.error.withRetry(x)` -> i18n key: `error.withRetry` (パラメータ {cause})
 *   `messages.validation.required(x)` -> i18n key: `validation.required` (パラメータ {label})
 *   `messages.confirm.finalizePayroll(y, m)` -> i18n key: `confirm.finalizePayroll` (パラメータ {year},{month})
 *
 * Loop 44 で react-i18next の resources.ja.translation にこの構造のまま流し込む予定。
 *
 * @i18n-namespace common
 */

export const messages = {
  /** @i18n-prefix empty */
  empty: {
    attendanceMonth: { title: '今月はまだ打刻記録がありません', description: '出勤ボタンから最初の打刻を始めましょう。' },
    attendanceDay: { title: 'この日の打刻記録はありません', description: '出勤すると、ここに記録が表示されます。' },
    shiftMonth: { title: '今月の確定シフトはまだありません', description: '上のボタンから最初の確定シフトを作成しましょう。' },
    shiftRequest: { title: '申請待ちのシフト申請はありません', description: 'メンバーから申請が届くとここに表示されます。' },
    shiftDay: { title: 'この日に確定シフトはありません' },
    shiftPreferenceMonth: { title: '今月のシフト申請はまだありません', description: 'シフト申請を登録してチームに共有しましょう。' },
    shiftPreferenceDay: { title: 'この日のシフト申請はありません' },
    shiftMismatch: { title: 'シフト不一致はありません', description: 'お疲れさまです。シフト申請と確定シフトはすべて一致しています。' },
    shiftPreset: { title: 'プリセットがまだありません', description: 'よく使うシフトパターンを登録すると一括適用がはかどります。' },
    leave: { title: '休暇申請はまだありません', description: '右上のボタンから新しい休暇申請を作成できます。' },
    correction: { title: '修正申請はまだありません', description: '履歴画面から打刻の修正を申請できます。' },
    member: { title: 'メンバーがまだいません', description: '招待コードを共有してメンバーを追加しましょう。' },
    store: { title: '店舗が未登録です', description: '最初の店舗を作成してメンバーを割り当てましょう。' },
    role: { title: '役職がまだありません', description: '役職を追加してメンバーに割り当てましょう。' },
    tenant: { title: 'ワークスペースがまだありません', description: '新しいワークスペースを作成するか、招待コードで参加しましょう。' },
    notification: { title: '通知はまだありません' },
    historyMonth: { title: '今月の勤怠履歴はまだありません' },
    history: { title: '勤怠履歴がまだありません' },
  },
  /** @i18n-prefix toast */
  toast: {
    /** @i18n-key toast.saved {target?} */
    saved: (target?: string): string => target ? `${target}を保存しました` : '保存しました',
    /** @i18n-key toast.created {target} */
    created: (target: string): string => `${target}を追加しました`,
    /** @i18n-key toast.updated {target} */
    updated: (target: string): string => `${target}を更新しました`,
    /** @i18n-key toast.deleted {target} */
    deleted: (target: string): string => `${target}を削除しました`,
    leftWorkspace: 'ワークスペースから抜けました',
    inviteCodeReissued: '招待コードを再発行しました',
    ownershipTransferred: '権限を移譲しました',
    storeManagerAssigned: '店長に任命しました',
    storeManagerUnassigned: '店長権限を外しました',
    memberRemoved: 'メンバーを外しました',
    memberAdded: 'メンバーを追加しました',
    correctionRequested: '修正申請を送信しました',
    correctionDeleted: '削除依頼を送信しました',
  },
  /** @i18n-prefix error */
  error: {
    fetchFailed: '読み込みに失敗しました。再試行するか時間をおいてお試しください。',
    saveFailed: '保存に失敗しました。入力内容を確認のうえ再度お試しください。',
    networkOffline: 'ネットワークに接続できません。電波状況を確認してください。',
    unexpected: '予期しないエラーが発生しました。時間をおいて再度お試しください。',
    /** @i18n-key error.withRetry {cause} */
    withRetry: (cause: string): string => `${cause} 再試行ボタンを押してお試しください。`,
  },
  /** @i18n-prefix validation */
  validation: {
    /** @i18n-key validation.required {label} */
    required: (label: string): string => `${label}を入力してください。`,
    /** @i18n-key validation.selectRequired {label} */
    selectRequired: (label: string): string => `${label}を選択してください。`,
    inviteCodeLength: '招待コードは6文字です。',
    timeNoChange: '変更がありません。出勤または退勤時刻を修正してください。',
    timeIdentical: '開始と終了の時刻が同じです。時刻を修正してください。',
    deadlinePassed: '提出締切を過ぎています。管理者にお問い合わせください。',
    closingDayRange: '締め日は 1〜31 の範囲で指定してください。',
  },
  /** @i18n-prefix confirm */
  confirm: {
    revertCorrection: 'この修正申請の承認を巻き戻しますか？\n勤怠レコードに加えた修正は元に戻されます。',
    /** @i18n-key confirm.finalizePayroll {year},{month} */
    finalizePayroll: (year: number, month: number): string => `${year}年${month}月の給与を確定しますか？`,
    /** @i18n-key confirm.unfinalizePayroll {year},{month} */
    unfinalizePayroll: (year: number, month: number): string => `${year}年${month}月の確定を取り消しますか？`,
    deleteShiftDeadline: 'シフト申請の提出期限を削除しますか？',
  },
  /** @i18n-prefix onboarding */
  onboarding: {
    /** @i18n-namespace onboarding */
    /** @i18n-key onboarding.welcome {tenantName} */
    welcome: (tenantName: string): string => `ようこそ ${tenantName} へ`,
    /** @i18n-key onboarding.description */
    description:
      '初回設定として、氏名（社内表記用）と表示名を入力してください。氏名はあなたと管理者（オーナー / マネージャー）のみが閲覧できます。',
    /** @i18n-key onboarding.submit */
    submit: '保存して始める',
    /** @i18n-key onboarding.legalNameLabel */
    legalNameLabel: '氏名（本名）',
    /** @i18n-key onboarding.legalNameHint */
    legalNameHint: 'あなたと管理者のみに表示されます',
    /** @i18n-key onboarding.displayNameLabel */
    displayNameLabel: '表示名',
    /** @i18n-key onboarding.displayNameHint */
    displayNameHint: 'シフト表・出退勤表で他のメンバーに表示されます',
    /** @i18n-key onboarding.legalNamePlaceholder */
    legalNamePlaceholder: '例: 山田 太郎',
    /** @i18n-key onboarding.displayNamePlaceholder */
    displayNamePlaceholder: '例: たろう',
    /** @i18n-key onboarding.saveError */
    saveError: '保存に失敗しました',
  },
} as const;
