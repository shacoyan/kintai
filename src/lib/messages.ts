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
    shiftMonth: { title: '今月のシフトはまだありません', description: '上のボタンから最初のシフトを作成しましょう。' },
    shiftRequest: { title: '申請待ちのシフト申請はありません', description: 'メンバーから申請が届くとここに表示されます。' },
    shiftDay: { title: 'この日にシフトはありません' },
    shiftPreferenceMonth: { title: '今月のシフト申請はまだありません', description: 'シフト申請を登録してチームに共有しましょう。' },
    shiftPreferenceDay: { title: 'この日のシフト申請はありません' },
    shiftMismatch: { title: 'シフト不一致はありません', description: 'お疲れさまです。シフト申請とシフトはすべて一致しています。' },
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
  /** @i18n-prefix invite */
  invite: {
    /** @i18n-namespace invite */
    /** @i18n-key invite.urlIssueTitle */
    urlIssueTitle: '招待URLを発行',
    /** @i18n-key invite.urlIssueDescription */
    urlIssueDescription:
      'この招待URLで参加するメンバーを、以下の店舗に自動的に配属します。',
    /** @i18n-key invite.storesLabel */
    storesLabel: '配属先店舗（任意・複数選択可）',
    /** @i18n-key invite.storesEmpty */
    storesEmpty: '※ 何も選択しなければテナント加入のみとなります',
    /** @i18n-key invite.storesPrimaryHint */
    storesPrimaryHint: '※ 複数選択時は最上位の店舗が「主店舗」になります',
    /** @i18n-key invite.storesNone */
    storesNone: '店舗が登録されていません',
    /** @i18n-key invite.expiresLabel */
    expiresLabel: '有効期限',
    /** @i18n-key invite.maxUsesLabel */
    maxUsesLabel: '使用回数',
    /** @i18n-key invite.urlPlaceholder */
    urlPlaceholder: '発行ボタンを押すと招待URLが表示されます',
    /** @i18n-key invite.urlLabel */
    urlLabel: '招待URL',
    /** @i18n-key invite.copyButton */
    copyButton: 'コピー',
    /** @i18n-key invite.copied */
    copied: '招待URLをコピーしました',
    /** @i18n-key invite.copyFailed */
    copyFailed: 'コピーに失敗しました。手動で選択してコピーしてください。',
    /** @i18n-key invite.issueButton */
    issueButton: '招待URLを発行',
    /** @i18n-key invite.reissueButton */
    reissueButton: '招待URLを再発行',
    /** @i18n-key invite.shareButton */
    shareButton: '招待URLを共有',
    /** @i18n-key invite.resetLink */
    resetLink: '招待コードをリセット',
    /** @i18n-key invite.resetConfirm */
    resetConfirm: '招待コードをリセットします。\n現在の招待URLは無効になり、新しい招待URLが発行されます。続行しますか？',
    /** @i18n-key invite.resetSuccess */
    resetSuccess: '招待コードをリセットしました',
    /** @i18n-key invite.settingsUpdated */
    settingsUpdated: '招待URLの設定を更新しました',
    /** @i18n-key invite.cancelButton */
    cancelButton: 'キャンセル',
    /** @i18n-key invite.urlIssued */
    urlIssued: '招待URLを発行しました',
    /** @i18n-key invite.urlIssuedAndCopied */
    urlIssuedAndCopied: '招待URLを発行してコピーしました',
    /** @i18n-key invite.autoCopyFailed */
    autoCopyFailed: '招待URLを発行しました（自動コピーは失敗しました。ボタンから手動でコピーしてください）',
    /** @i18n-key invite.reissueWarning */
    reissueWarning:
      '再発行すると以前の招待URLは無効になり、使用回数カウントは 0 にリセットされます。',
    /** @i18n-key invite.permissionDenied */
    permissionDenied: 'オーナーまたは店長のみ実行可能です',
    /** @i18n-key invite.joinTitle {tenantName} */
    joinTitle: (tenantName: string): string => `${tenantName} へ招待されています`,
    /** @i18n-key invite.joinTitleFallback */
    joinTitleFallback: 'kintai に招待されています',
    /** @i18n-key invite.joinDescription */
    joinDescription:
      'ログイン後、加入後にあらためて本名（管理者のみが閲覧）の入力をお願いします。',
    /** @i18n-key invite.assignedStoresLabel */
    assignedStoresLabel: '配属予定の店舗',
    /** @i18n-key invite.assignedStoresNone */
    assignedStoresNone: '店舗の配属はありません（テナント加入のみ）',
    /** @i18n-key invite.primaryStoreSuffix */
    primaryStoreSuffix: '（主）',
    /** @i18n-key invite.joinButton */
    joinButton: '参加する',
    /** @i18n-key invite.backHomeButton */
    backHomeButton: 'ホームへ戻る',
    /** @i18n-key invite.goDashboardButton */
    goDashboardButton: 'ダッシュボードへ',
    /** @i18n-key invite.alreadyMember */
    alreadyMember: 'すでにこのテナントに参加しています',
    /** @i18n-key invite.codeNotFound */
    codeNotFound: '招待コードが見つかりません',
    /** @i18n-key invite.codeExpired */
    codeExpired: '招待コードの有効期限が切れています',
    /** @i18n-key invite.codeMaxUsesReached */
    codeMaxUsesReached: '招待コードの使用回数上限に達しました',
    /** @i18n-key invite.codeInvalid */
    codeInvalid: '無効な招待コードです',
    /** @i18n-key invite.joinFailed */
    joinFailed: '参加に失敗しました。しばらく待ってから再度お試しください。',
    /** @i18n-key invite.previewUnavailable */
    previewUnavailable: 'ログイン後に招待先の情報が表示されます。',
    /** @i18n-key invite.urlValidUntil {date} */
    urlValidUntil: (date: string): string => `有効期限: ${date}`,
    /** @i18n-key invite.urlValidIndefinitely */
    urlValidIndefinitely: '有効期限: 無期限',
    /** @i18n-key invite.usageStatus {used},{max} */
    usageStatus: (used: number, max: number): string => `使用回数: ${used} / ${max}`,
    /** @i18n-key invite.usageStatusUnlimited {used} */
    usageStatusUnlimited: (used: number): string => `使用回数: ${used} / 無制限`,
    /** @i18n-key invite.listTitle */
    listTitle: '招待URL の管理',
    /** @i18n-key invite.listEmpty */
    listEmpty: 'まだ招待URL を発行していません。',
    /** @i18n-key invite.newCodeButton */
    newCodeButton: '新規発行',
    /** @i18n-key invite.storesPlaceholder */
    storesPlaceholder: '配属先店舗',
    /** @i18n-key invite.storesHintOptional */
    storesHintOptional: '店舗を選択しないとテナント加入のみとなります',
    /** @i18n-key invite.assignedStoresHiddenUntilJoin */
    assignedStoresHiddenUntilJoin: '配属予定店舗は加入後に確認できます',
    /** @i18n-key invite.labelPlaceholder */
    labelPlaceholder: 'メモ（任意・例: 4月新人向け 本店）',
    /** @i18n-key invite.labelHint */
    labelHint: '※ 自分用のメモ。スタッフには見えません',
    /** @i18n-key invite.rowLabelFallback */
    rowLabelFallback: '(メモなし)',
    /** @i18n-key invite.rowStoresLabel */
    rowStoresLabel: '配属先',
    /** @i18n-key invite.rowExpiresLabel */
    rowExpiresLabel: '有効期限',
    /** @i18n-key invite.rowUsageLabel */
    rowUsageLabel: '使用',
    /** @i18n-key invite.rowActionEdit */
    rowActionEdit: '設定変更',
    /** @i18n-key invite.rowActionRevoke */
    rowActionRevoke: '失効',
    /** @i18n-key invite.rowActionCopy */
    rowActionCopy: 'URL コピー',
    /** @i18n-key invite.revokeConfirm */
    revokeConfirm: 'この招待URL を失効させます。\nこれ以降のアクセスは無効になります。続行しますか？',
    /** @i18n-key invite.revokeSuccess */
    revokeSuccess: '招待URL を失効しました',
    /** @i18n-key invite.issueSuccess */
    issueSuccess: '招待URL を発行してコピーしました',
    /** @i18n-key invite.updateSuccess */
    updateSuccess: '招待URL の設定を更新しました',
  },
  /** @i18n-prefix shiftPreference */
  shiftPreference: {
    /** @i18n-key shiftPreference.approvedLockedTitle */
    approvedLockedTitle: '承認済みのシフト申請は変更できません',
    /** @i18n-key shiftPreference.approvedLockedDescription */
    approvedLockedDescription: '修正が必要な場合は店長にご相談ください。',
    /** @i18n-key shiftPreference.unavailableApprovedNotice */
    unavailableApprovedNotice: '出勤不可の解除は店長に通知され、承認が再度必要になります。',
    /** @i18n-namespace shiftPreference.bulk */
    bulk: {
      /** @i18n-key shiftPreference.bulk.entryButton */
      entryButton: 'まとめて申請',
      /** @i18n-key shiftPreference.bulk.entryButtonAria */
      entryButtonAria: '複数の日付にまとめてシフト申請を行う',
      /** @i18n-key shiftPreference.bulk.cancelMode */
      cancelMode: 'キャンセル',
      /** @i18n-key shiftPreference.bulk.clearAll */
      clearAll: 'すべて解除',
      /** @i18n-key shiftPreference.bulk.selectedCount */
      selectedCount: (count: number): string => `${count}日選択中`,
      /** @i18n-key shiftPreference.bulk.proceedButton */
      proceedButton: (count: number): string => `${count}日を一括申請`,
      /** @i18n-key shiftPreference.bulk.dialogTitle */
      dialogTitle: '一括シフト申請',
      /** @i18n-key shiftPreference.bulk.dateCount */
      dateCount: (count: number): string => `${count}日を選択中`,
      /** @i18n-key shiftPreference.bulk.typeLabel */
      typeLabel: '希望種別',
      /** @i18n-key shiftPreference.bulk.typePreferred */
      typePreferred: '希望',
      /** @i18n-key shiftPreference.bulk.typeUnavailable */
      typeUnavailable: '出勤不可',
      /** @i18n-key shiftPreference.bulk.presetLabel */
      presetLabel: 'プリセット',
      /** @i18n-key shiftPreference.bulk.presetPlaceholder */
      presetPlaceholder: '-- 選択 --',
      /** @i18n-key shiftPreference.bulk.presetCustom */
      presetCustom: 'カスタム時刻',
      /** @i18n-key shiftPreference.bulk.presetEmpty */
      presetEmpty:
        'プリセットが未登録です。設定 > プリセットから追加するか「カスタム時刻」を選んでください。',
      /** @i18n-key shiftPreference.bulk.customStartLabel */
      customStartLabel: '開始時刻',
      /** @i18n-key shiftPreference.bulk.customEndLabel */
      customEndLabel: '終了時刻',
      /** @i18n-key shiftPreference.bulk.unavailableHint */
      unavailableHint: '出勤不可は時間指定なしで一括登録され、自動承認されます。',
      /** @i18n-key shiftPreference.bulk.overwriteWarning */
      overwriteWarning: (total: number, overwrite: number): string =>
        `選択した${total}日のうち${overwrite}日に既存の申請があります。上書きされます。`,
      /** @i18n-key shiftPreference.bulk.lockedWarning */
      lockedWarning: (total: number, locked: number): string =>
        `${total}日中${locked}日は承認済のためスキップされます。`,
      /** @i18n-key shiftPreference.bulk.submitButton */
      submitButton: '申請する',
      /** @i18n-key shiftPreference.bulk.submitting */
      submitting: '送信中…',
      /** @i18n-key shiftPreference.bulk.cancelButton */
      cancelButton: 'キャンセル',
      /** @i18n-key shiftPreference.bulk.successToast */
      successToast: (count: number): string => `${count}日のシフト申請を登録しました`,
      /** @i18n-key shiftPreference.bulk.partialFailureToast */
      partialFailureToast: (success: number, failed: number): string =>
        `${success}日 成功 / ${failed}日 失敗（承認済または競合のためスキップ）`,
      /** @i18n-key shiftPreference.bulk.lockedToast */
      lockedToast: '承認済みのシフト申請はスキップされました。',
      /** @i18n-key shiftPreference.bulk.failureToast */
      failureToast: '一括シフト申請に失敗しました。時間をおいて再度お試しください。',
      /** @i18n-key shiftPreference.bulk.validationError */
      validationError: '入力内容にエラーがあります。修正してください。',
      /** @i18n-key shiftPreference.bulk.timeRequired */
      timeRequired: '時刻を入力してください',
      /** @i18n-key shiftPreference.bulk.maxSelectionExceeded */
      maxSelectionExceeded: (max: number): string => `選択できるのは${max}日までです。`,
      /** @i18n-key shiftPreference.bulk.deadlinePassed */
      deadlinePassed: '提出締切を過ぎているため申請できません。',
    },
  },
} as const;
