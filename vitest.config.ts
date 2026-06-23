import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// vitest はデフォルトで **/*.{test,spec}.* を収集するため、Playwright の e2e/*.spec.ts
// （@playwright/test を import するファイル）まで拾い、"Playwright Test did not expect
// test() to be called here." で収集エラーになる。ここで収集対象を unit テスト
// （*.test.ts / *.test.tsx）に限定し、e2e と Playwright spec を除外する。
// api/ 配下の Vercel Functions ユニットテスト（*.test.js）も対象に含める（B7）。
// vite.config.ts の react plugin / manualChunks 設定は mergeConfig で維持する。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.{js,ts}'],
      exclude: ['node_modules/**', 'dist/**', 'e2e/**', '**/*.spec.ts', 'tests/**'],
    },
  }),
);
