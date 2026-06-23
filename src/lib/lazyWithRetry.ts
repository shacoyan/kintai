import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

export const CHUNK_ERR =
  /Loading chunk|dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch/i;
export const CHUNK_RELOAD_FLAG = 'kintai:chunk-reload';

/**
 * `React.lazy` のラッパー。動的 import が失敗したら backoff 付きで再試行し、
 * それでも chunk 読み込み系の失敗なら 1 回だけ window.location.reload で復旧を試みる。
 * - 成功時は CHUNK_RELOAD_FLAG をクリアして reload ループを防ぐ
 * - 既に reload 済み(flag='1')なら throw してエラー UI に委ねる
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 1,
  backoffMs = 300,
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory();
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
        } catch {
          /* ignore */
        }
        return mod;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (CHUNK_ERR.test(msg)) {
      let already = false;
      try {
        already = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1';
      } catch {
        /* ignore */
      }
      if (!already) {
        try {
          sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
        } catch {
          /* ignore */
        }
        window.location.reload();
        return new Promise<{ default: T }>(() => {
          /* never resolves; avoid error-UI flash before reload */
        });
      }
    }
    throw lastErr;
  });
}
