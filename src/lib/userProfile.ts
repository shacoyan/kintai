import type { User } from '@supabase/supabase-js';

export interface SignupProfileMetadata {
  legalName: string;
  legalNameKana: string; // 未設定なら ''
  displayName: string;
}

const LEGAL_NAME_MAX = 50;
const LEGAL_NAME_KANA_MAX = 50;
const DISPLAY_NAME_MAX = 30;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * サインアップ時に user_metadata へ保存した本名/フリガナ/勤務時名を読み出す。
 * metadata が無い（既存ユーザー）・必須項目欠落・上限超過の場合は null を返し、
 * 呼び出し側は従来の Onboarding Dialog 導線にフォールバックする。
 */
export function readSignupProfile(user: User | null | undefined): SignupProfileMetadata | null {
  if (!user) return null;

  const metadata = user.user_metadata ?? {};
  const legalName = readString(metadata.legal_name);
  const legalNameKana = readString(metadata.legal_name_kana);
  const displayName = readString(metadata.display_name);

  if (legalName === '' || displayName === '') return null;
  if (legalName.length > LEGAL_NAME_MAX) return null;
  if (legalNameKana.length > LEGAL_NAME_KANA_MAX) return null;
  if (displayName.length > DISPLAY_NAME_MAX) return null;

  return { legalName, legalNameKana, displayName };
}
