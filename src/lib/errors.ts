/**
 * Supabase / 一般エラーをユーザー向け日本語メッセージへ変換するヘルパ。
 * 本ループでは関数提供のみ。既存 catch 句の置換は Loop 11 で実施。
 */

export interface FriendlyError {
  message: string;
  code?: string;
  original: unknown;
}

const KNOWN_CODE_MESSAGES: Record<string, string> = {
  '42501': '権限がありません。管理者に確認してください。',
  '23505': 'すでに登録されています。',
  '23503': '関連するデータが見つかりません。',
  '23502': '必須項目が入力されていません。',
  PGRST116: 'データが見つかりませんでした。',
  PGRST301: 'ログインの有効期限が切れました。再度ログインしてください。',
  '22P02': '入力値の形式が正しくありません。',
  '42P01': 'システムエラーが発生しました。サポートに連絡してください。',
};

function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    if (typeof code === 'number') return String(code);
  }
  return undefined;
}

function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return undefined;
}

/**
 * Supabase エラー（PostgREST / Postgres code 等）をユーザー向け日本語に整形。
 * 既知 code に該当しない場合は err.message を、それも無ければ汎用文言を返す。
 */
export function formatSupabaseError(err: unknown): FriendlyError {
  const code = extractCode(err);
  if (code && KNOWN_CODE_MESSAGES[code]) {
    return { message: KNOWN_CODE_MESSAGES[code], code, original: err };
  }
  const msg = extractMessage(err);
  return {
    message: msg ?? '予期しないエラーが発生しました。',
    code,
    original: err,
  };
}
