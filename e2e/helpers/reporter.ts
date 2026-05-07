import { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * テスト実行中に発生したコンソールログ、エラー、スクリーンショット等の記録を保持するエントリ
 */
interface ReportEntry {
  /** タイムスタンプ (ISO 形式) */
  ts: string;
  /** テストスコープ名 */
  scope: string;
  /** ログレベル */
  level: 'info' | 'warn' | 'error';
  /** メッセージ本文 */
  message: string;
  /** スクリーンショットのファイルパス (エラー時のみ) */
  screenshotPath?: string;
}

/** モジュールスコープで全 spec 共有のレポートエントリ配列 */
const entries: ReportEntry[] = [];

/** 誤報を info に格下げするためのノイズパターン */
const NOISE_PATTERNS = [
  /\[Vite\] hmr update/,
  /Encountered two children with the same key/,
  /GoTrueClient/,
];

/** レポーターインターフェース */
export interface Reporter {
  /** info レベルのログを記録する */
  log(msg: string): void;
  /** error レベルのログを記録する */
  error(msg: string): void;
  /** テストステップをラップし、失敗時にスクリーンショットを保存してエラーを記録する */
  step(label: string, fn: () => Promise<void>): Promise<void>;
}

/**
 * メッセージがノイズパターンに一致するか判定し、レベルを info に格下げるか決定する
 */
function determineLevel(
  baseLevel: 'warn' | 'error',
  message: string,
): 'info' | 'warn' | 'error' {
  if (NOISE_PATTERNS.some((p) => p.test(message))) return 'info';
  return baseLevel;
}

/**
 * Page インスタンスにレポーターをアタッチし、コンソール・エラー・リクエスト失敗を監視する
 * @param page - Playwright の Page オブジェクト
 * @param scope - テストスコープ名 (spec ファイル名等)
 * @returns Reporter インターフェース
 */
export function attachReporter(page: Page, scope: string): Reporter {
  // コンソールメッセージの監視
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    const ts = new Date().toISOString();

    if (type === 'error') {
      entries.push({
        ts,
        scope,
        level: determineLevel('error', text),
        message: text,
      });
    } else if (type === 'warning') {
      entries.push({
        ts,
        scope,
        level: determineLevel('warn', text),
        message: text,
      });
    }
  });

  // ページエラーの監視
  page.on('pageerror', (err) => {
    entries.push({
      ts: new Date().toISOString(),
      scope,
      level: 'error',
      message: err.message,
    });
  });

  // リクエスト失敗の監視
  page.on('requestfailed', (req) => {
    entries.push({
      ts: new Date().toISOString(),
      scope,
      level: 'error',
      message: `Request failed: ${req.method()} ${req.url()} - ${req.failure()?.errorText ?? 'Unknown'}`,
    });
  });

  return {
    log(msg: string): void {
      entries.push({
        ts: new Date().toISOString(),
        scope,
        level: 'info',
        message: msg,
      });
    },
    error(msg: string): void {
      entries.push({
        ts: new Date().toISOString(),
        scope,
        level: 'error',
        message: msg,
      });
    },
    async step(label: string, fn: () => Promise<void>): Promise<void> {
      try {
        await fn();
      } catch (err) {
        const timestamp = Date.now();
        const safeLabel = label.replace(/[^\w]/g, '_');
        const dir = path.join(process.cwd(), 'tmp', 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const filename = `${scope}-${safeLabel}-${timestamp}.png`;
        const screenshotPath = path.join(dir, filename);

        try {
          await page.screenshot({ path: screenshotPath });
        } catch {
          // スクリーンショット取得失敗は無視
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        entries.push({
          ts: new Date().toISOString(),
          scope,
          level: 'error',
          message: `[${label}] ${errorMsg}`,
          screenshotPath,
        });

        throw err;
      }
    },
  };
}

/**
 * エントリ配列から Markdown 形式のレポートを生成する
 * @param ents - レポートエントリ配列
 * @returns Markdown 文字列
 */
function renderMarkdown(ents: ReportEntry[]): string {
  const lines: string[] = [];
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  lines.push(`# kintai 1ヶ月分シフト E2E テストレポート (${dateStr})`);
  lines.push('');

  // サマリ
  const infoCount = ents.filter((e) => e.level === 'info').length;
  const warnCount = ents.filter((e) => e.level === 'warn').length;
  const errorCount = ents.filter((e) => e.level === 'error').length;
  const screenshotCount = ents.filter((e) => e.screenshotPath).length;

  lines.push('## サマリ');
  lines.push(`- 実行時刻: ${now.toISOString()}`);
  lines.push(`- info: ${infoCount} 件`);
  lines.push(`- warn: ${warnCount} 件`);
  lines.push(`- error: ${errorCount} 件`);
  lines.push(`- screenshots: ${screenshotCount} 件`);
  lines.push('');

  // 致命的 (level=error)
  lines.push('## 致命的 (level=error)');
  const errors = ents.filter((e) => e.level === 'error');
  if (errors.length === 0) {
    lines.push('_(なし)_');
  } else {
    errors.forEach((e) => {
      const ss = e.screenshotPath
        ? ` [screenshot](${e.screenshotPath})`
        : '';
      lines.push(`- [${e.ts}] [${e.scope}] ${e.message}${ss}`);
    });
  }
  lines.push('');

  // 警告 (level=warn)
  lines.push('## 警告 (level=warn)');
  const warnings = ents.filter((e) => e.level === 'warn');
  if (warnings.length === 0) {
    lines.push('_(なし)_');
  } else {
    warnings.forEach((e) => {
      lines.push(`- [${e.ts}] [${e.scope}] ${e.message}`);
    });
  }
  lines.push('');

  // 情報 (level=info, 抜粋: 先頭50件のみ)
  lines.push('## 情報 (level=info, 抜粋: 先頭 50 件のみ)');
  const infos = ents.filter((e) => e.level === 'info');
  if (infos.length === 0) {
    lines.push('_(なし)_');
  } else {
    infos.slice(0, 50).forEach((e) => {
      lines.push(`- [${e.ts}] [${e.scope}] ${e.message}`);
    });
    if (infos.length > 50) {
      lines.push(`- ... 他 ${infos.length - 50} 件`);
    }
  }
  lines.push('');

  // scope 別件数テーブル
  lines.push('## scope 別件数');
  const scopeMap = new Map<string, { info: number; warn: number; error: number }>();
  for (const e of ents) {
    const s = scopeMap.get(e.scope) ?? { info: 0, warn: 0, error: 0 };
    s[e.level]++;
    scopeMap.set(e.scope, s);
  }

  if (scopeMap.size === 0) {
    lines.push('_(なし)_');
  } else {
    lines.push('| scope | info | warn | error |');
    lines.push('|-------|------|------|-------|');
    for (const [scope, counts] of scopeMap) {
      lines.push(
        `| ${scope} | ${counts.info} | ${counts.warn} | ${counts.error} |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * 蓄積されたレポートエントリを Markdown ファイルとして出力する
 * @param outPath - 出力ファイルパス (省略時は tmp/2026-05-07-1month-shift-test-report.md)
 */
export function flushReport(
  outPath?: string,
): void {
  const resolvedPath = outPath
    ?? path.join(process.cwd(), 'tmp', '2026-05-07-1month-shift-test-report.md');
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });
  const markdown = renderMarkdown(entries);
  fs.writeFileSync(resolvedPath, markdown, 'utf-8');
}
