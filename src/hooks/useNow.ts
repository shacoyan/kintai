import { useSyncExternalStore } from 'react';

/**
 * 現在時刻を一定間隔で返す共通フック。
 *
 * PERF-1 (Loop9): モジュールスコープに 1 本だけ setInterval を持つ集約 clock。
 * 複数コンポーネントが useNow を呼んでも setInterval は 1 つだけ生成され、
 * 全 subscriber が同じ Date 参照を受け取る（参照同一性も維持）。
 *
 * 互換: 既存 `useNow(intervalMs)` 呼び出しを維持するため引数を受け取り、
 * intervalMs ごとに独立した ticker bucket を保持する。
 *
 * 重要: useSyncExternalStore は subscribe / getSnapshot の参照同一性が
 * 切り替わると再購読してしまうため、intervalMs ごとに **キャッシュした**
 * subscribe / getSnapshot を返す。
 */

type Listener = () => void;

interface Ticker {
  listeners: Set<Listener>;
  now: Date;
  intervalId: ReturnType<typeof setInterval> | null;
  subscribe: (cb: Listener) => () => void;
  getSnapshot: () => Date;
}

const tickers = new Map<number, Ticker>();

function getTicker(intervalMs: number): Ticker {
  let t = tickers.get(intervalMs);
  if (!t) {
    const ticker: Ticker = {
      listeners: new Set(),
      now: new Date(),
      intervalId: null,
      subscribe: (cb: Listener) => {
        ticker.listeners.add(cb);
        if (ticker.intervalId === null) {
          // 加入直後に最新時刻へ同期
          ticker.now = new Date();
          ticker.intervalId = setInterval(() => {
            ticker.now = new Date();
            ticker.listeners.forEach((l) => l());
          }, intervalMs);
        }
        return () => {
          ticker.listeners.delete(cb);
          if (ticker.listeners.size === 0 && ticker.intervalId !== null) {
            clearInterval(ticker.intervalId);
            ticker.intervalId = null;
          }
        };
      },
      getSnapshot: () => ticker.now,
    };
    tickers.set(intervalMs, ticker);
    t = ticker;
  }
  return t;
}

export function useNow(intervalMs: number = 1000): Date {
  const ticker = getTicker(intervalMs);
  return useSyncExternalStore(ticker.subscribe, ticker.getSnapshot, ticker.getSnapshot);
}
