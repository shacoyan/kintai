/**
 * Kanban の表示状態を localStorage に persist する helper (Phase 2 Loop 0)
 *
 * 設計書: .company/engineering/docs/2026-05-22-kintai-task-kanban-phase2-techdesign.md §3-7
 *
 * 管理キー:
 * - `kintai.tasks.viewMode` … `'kanban' | 'list'`
 * - `kintai.tasks.storeTab` … `JSON.stringify(StoreTabValue)`
 *
 * SSR / プライベートモードでの localStorage 失敗を考慮し、すべて try/catch + null
 * フォールバックで安全に動かす。tenant 切替時は `writeStoreTab(null)` で明示クリア。
 */
import type { StoreTabValue, ViewMode } from '../components/Kanban/types';

const VIEW_MODE_KEY = 'kintai.tasks.viewMode';
const STORE_TAB_KEY = 'kintai.tasks.storeTab';

const DEFAULT_VIEW_MODE: ViewMode = 'kanban';
const DEFAULT_STORE_TAB: StoreTabValue = { kind: 'all' };

/** localStorage が利用可能か (SSR / プライベートモード等で false) */
function isStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/* ───────────── viewMode ───────────── */

/**
 * 表示モードを localStorage から読む。
 * 未保存 / 不正値 / 読み取り失敗時は `'kanban'` を返す。
 */
export function readViewMode(): ViewMode {
  if (!isStorageAvailable()) return DEFAULT_VIEW_MODE;
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    if (raw === 'kanban' || raw === 'list') return raw;
    return DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/**
 * 表示モードを localStorage に書く。
 * `null` を渡すとキーごと削除 (tenant 切替時の reset 用)。
 */
export function writeViewMode(value: ViewMode | null): void {
  if (!isStorageAvailable()) return;
  try {
    if (value === null) {
      window.localStorage.removeItem(VIEW_MODE_KEY);
      return;
    }
    window.localStorage.setItem(VIEW_MODE_KEY, value);
  } catch {
    /* 容量超過 / プライベートモード等は無視 */
  }
}

/* ───────────── storeTab ───────────── */

/** 任意値が StoreTabValue として妥当か判定 (JSON.parse 後の型ガード) */
function isStoreTabValue(v: unknown): v is StoreTabValue {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'all' || kind === 'company') return true;
  if (kind === 'store') {
    const storeId = (v as { storeId?: unknown }).storeId;
    return typeof storeId === 'string' && storeId.length > 0;
  }
  return false;
}

/**
 * 店舗タブの値を localStorage から読む。
 * 未保存 / 不正値 / 読み取り失敗時は `{ kind: 'all' }` を返す。
 */
export function readStoreTab(): StoreTabValue {
  if (!isStorageAvailable()) return DEFAULT_STORE_TAB;
  try {
    const raw = window.localStorage.getItem(STORE_TAB_KEY);
    if (!raw) return DEFAULT_STORE_TAB;
    const parsed: unknown = JSON.parse(raw);
    if (isStoreTabValue(parsed)) return parsed;
    return DEFAULT_STORE_TAB;
  } catch {
    return DEFAULT_STORE_TAB;
  }
}

/**
 * 店舗タブの値を localStorage に書く。
 * `null` を渡すとキーごと削除 (tenant 切替時の reset 用)。
 */
export function writeStoreTab(value: StoreTabValue | null): void {
  if (!isStorageAvailable()) return;
  try {
    if (value === null) {
      window.localStorage.removeItem(STORE_TAB_KEY);
      return;
    }
    window.localStorage.setItem(STORE_TAB_KEY, JSON.stringify(value));
  } catch {
    /* 容量超過 / プライベートモード等は無視 */
  }
}
