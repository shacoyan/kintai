/**
 * kintai logger — 将来 Sentry 等に差し替え可能な抽象化レイヤー
 *
 * 現状は console にフォワードするのみ。Sentry 等へ送る際は
 * このファイル内の各関数を差し替えるだけで全コードが追従する。
 */

type LogContext = Record<string, unknown> | undefined;

function isDev(): boolean {
  return import.meta.env.DEV;
}

export const logger = {
  debug(message: string, ctx?: LogContext): void {
    if (isDev()) console.debug(`[debug] ${message}`, ctx ?? '');
  },
  info(message: string, ctx?: LogContext): void {
    if (isDev()) console.info(`[info] ${message}`, ctx ?? '');
  },
  warn(message: string, ctx?: LogContext): void {
    console.warn(`[warn] ${message}`, ctx ?? '');
  },
  error(message: string, errOrCtx?: unknown): void {
    console.error(`[error] ${message}`, errOrCtx ?? '');
    // 将来 Sentry: Sentry.captureException(errOrCtx instanceof Error ? errOrCtx : new Error(message), { extra: { ctx: errOrCtx } });
  },
};
