/**
 * 招待URLの生成・解析、および参加コードの一時保存を行うユーティリティ。
 * 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §3.4 / §3.5 / §6.5
 * @module inviteUrl
 */

/** 保留中の参加コードを保存する localStorage キー */
export const PENDING_JOIN_CODE_STORAGE_KEY = 'kintai_pending_join_code';

/**
 * 招待URLを生成する。
 * base URL は VITE_APP_BASE_URL を優先、未定義なら window.location.origin にフォールバック。
 * @param code - 招待コード（生文字列。encodeURIComponent はこの関数内で行う）
 * @returns 招待URL（例: `https://shahu-kintai.vercel.app/join?code=ABC123`）
 */
export function buildInviteUrl(code: string): string {
  const envBase = (import.meta.env.VITE_APP_BASE_URL as string | undefined) ?? '';
  const base =
    envBase && envBase.length > 0
      ? envBase.replace(/\/+$/, '') // 末尾スラッシュ除去
      : (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/join?code=${encodeURIComponent(code)}`;
}

/**
 * URL の search 文字列から招待コードを抽出する。
 * `?code=ABC123` / `code=ABC123` / `?foo=bar&code=ABC123` いずれの形式も受理する。
 * 大文字化は呼び出し側に委ねる（Tenant の invite_code 表記揺れを吸収するため）。
 * @param search - クエリ文字列（先頭の `?` 有無不問）
 * @returns 抽出した招待コード、見つからない or 空文字なら null
 */
export function parseInviteCodeFromUrl(search: string): string | null {
  if (!search) return null;
  const match = search.match(/(?:^|\?|&)code=([^&]*)/);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return decoded === '' ? null : decoded;
}

/**
 * localStorage から保留中の参加コードを取得する。
 * SSR / プライベートブラウジング等で localStorage 不可な場合は null を返す。
 */
export function getPendingJoinCode(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PENDING_JOIN_CODE_STORAGE_KEY);
  } catch (error) {
    console.warn('[inviteUrl] localStorage read failed:', error);
    return null;
  }
}

/**
 * localStorage に保留中の参加コードを保存する。
 * sessionStorage を使わない理由: メール確認リンク経由で別タブが開かれた際に
 * 復帰できなくなるリスクを避けるため（設計書 §9 R1）。
 */
export function setPendingJoinCode(code: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PENDING_JOIN_CODE_STORAGE_KEY, code);
  } catch (error) {
    console.warn('[inviteUrl] localStorage write failed:', error);
  }
}

/** localStorage から保留中の参加コードを削除する。 */
export function clearPendingJoinCode(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PENDING_JOIN_CODE_STORAGE_KEY);
  } catch (error) {
    console.warn('[inviteUrl] localStorage remove failed:', error);
  }
}
