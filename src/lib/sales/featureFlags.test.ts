import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FF_USE_SALES_RANGE, getUseSalesRange, setUseSalesRange } from './featureFlags';

/**
 * 最小限の localStorage モック (node 環境用)。
 * vitest デフォルト環境は node で `localStorage` 未提供のため、
 * globalThis.localStorage に手動で注入する。
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

type GlobalWithStorage = typeof globalThis & { localStorage?: Storage };

describe('featureFlags / getUseSalesRange', () => {
  let originalStorage: Storage | undefined;

  beforeEach(() => {
    const g = globalThis as GlobalWithStorage;
    originalStorage = g.localStorage;
    g.localStorage = createMemoryStorage();
  });

  afterEach(() => {
    const g = globalThis as GlobalWithStorage;
    if (originalStorage === undefined) {
      delete (g as { localStorage?: Storage }).localStorage;
    } else {
      g.localStorage = originalStorage;
    }
    vi.restoreAllMocks();
  });

  it('default (未設定) のとき true を返す', () => {
    expect(getUseSalesRange()).toBe(true);
  });

  it("'0' のとき false を返す", () => {
    (globalThis as GlobalWithStorage).localStorage!.setItem(FF_USE_SALES_RANGE, '0');
    expect(getUseSalesRange()).toBe(false);
  });

  it("'false' のとき false を返す", () => {
    (globalThis as GlobalWithStorage).localStorage!.setItem(FF_USE_SALES_RANGE, 'false');
    expect(getUseSalesRange()).toBe(false);
  });

  it("'1' のとき true を返す", () => {
    (globalThis as GlobalWithStorage).localStorage!.setItem(FF_USE_SALES_RANGE, '1');
    expect(getUseSalesRange()).toBe(true);
  });

  it("'true' のとき true を返す", () => {
    (globalThis as GlobalWithStorage).localStorage!.setItem(FF_USE_SALES_RANGE, 'true');
    expect(getUseSalesRange()).toBe(true);
  });

  it('認識できない値のときは default (true) を返す', () => {
    (globalThis as GlobalWithStorage).localStorage!.setItem(FF_USE_SALES_RANGE, 'maybe');
    expect(getUseSalesRange()).toBe(true);
  });

  it('localStorage.getItem が throw しても true (default) を返す', () => {
    const storage = (globalThis as GlobalWithStorage).localStorage!;
    const spy = vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(getUseSalesRange()).toBe(true);
    spy.mockRestore();
  });

  it('localStorage 未定義環境 (SSR 相当) で true を返す', () => {
    const g = globalThis as GlobalWithStorage;
    const saved = g.localStorage;
    delete (g as { localStorage?: Storage }).localStorage;
    expect(getUseSalesRange()).toBe(true);
    g.localStorage = saved;
  });
});

describe('featureFlags / setUseSalesRange', () => {
  let originalStorage: Storage | undefined;

  beforeEach(() => {
    const g = globalThis as GlobalWithStorage;
    originalStorage = g.localStorage;
    g.localStorage = createMemoryStorage();
  });

  afterEach(() => {
    const g = globalThis as GlobalWithStorage;
    if (originalStorage === undefined) {
      delete (g as { localStorage?: Storage }).localStorage;
    } else {
      g.localStorage = originalStorage;
    }
    vi.restoreAllMocks();
  });

  it('true で 1 を保存する', () => {
    setUseSalesRange(true);
    expect((globalThis as GlobalWithStorage).localStorage!.getItem(FF_USE_SALES_RANGE)).toBe('1');
  });

  it('false で 0 を保存する', () => {
    setUseSalesRange(false);
    expect((globalThis as GlobalWithStorage).localStorage!.getItem(FF_USE_SALES_RANGE)).toBe('0');
  });

  it('localStorage が例外を投げても throw しない', () => {
    const storage = (globalThis as GlobalWithStorage).localStorage!;
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setUseSalesRange(true)).not.toThrow();
    spy.mockRestore();
  });
});
