import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import type { StoreMonthlySettingsForm } from '../lib/reports/types';

// =============================================================================
// useStoreMonthlySettings — 月次マスタ（store_monthly_settings）CRUD hook
// -----------------------------------------------------------------------------
// 設計書 §1.9・§4.5・§5.3・§5.6（Loop D/E）。
//
//   - public テーブル `store_monthly_settings` を `supabase`（public クライアント）
//     で直接 SELECT / upsert する。managerial のみ RLS 通過（呼び出し側 UI も
//     managerial のみ描画する二層防御）。hook 自体は RLS に委ねる。
//   - **保存（saveSettings）= upsert(onConflict='tenant_id,store_id,year,month') +
//     `.select()` RETURNING 必須 → 0 件ならエラー化**（supabase-js の UPDATE/UPSERT
//     は RLS 0 行を無音 success にするため／§5.3・R4）。
//   - created_by / updated_by は **フロントで auth.uid() をセット**（論点 h・§4.5）。
//     created_by は INSERT のみ（既存行を上書きしない）／updated_by は常時。
//     → upsert 一本では UPDATE 時に created_by を変えたくないため、SELECT 済みの
//       既存有無で INSERT/UPDATE を分岐する（INSERT は created_by+updated_by、
//       UPDATE は updated_by のみ）。どちらも `.select()` RETURNING 0 件エラー化。
//   - **前月複写（copyFromPrevMonth）**: (year, month) の前月 settings を SELECT し、
//     フォーム値だけを返す（保存はユーザーが押すまでしない）。前月が無ければ null。
//   - 取得（SELECT）: storeId / year / month 揃い時のみ。stale クリア（B17）。
//   - エラーは全文表示（短縮禁止）。
// =============================================================================

/** store_monthly_settings 行（RETURNING の最小型）。 */
export interface StoreMonthlySettingsRow {
  tenant_id: string;
  store_id: string;
  year: number;
  month: number;
  fixed_payroll_employee: number;
  rent: number;
  utilities: number;
  communication: number;
  advertising: number;
  other_sga_fixed: number;
  sales_target: number;
  created_by: string | null;
  updated_by: string | null;
}

export interface UseStoreMonthlySettingsResult {
  data: StoreMonthlySettingsRow | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  reload: () => void;
  /** マスタを upsert（INSERT/UPDATE 分岐・RETURNING 0 件エラー化）。tenantId 必須。 */
  saveSettings: (
    tenantId: string,
    form: StoreMonthlySettingsForm,
  ) => Promise<StoreMonthlySettingsRow>;
  /** 前月マスタをフォーム値として取得（保存はしない）。無ければ null。 */
  copyFromPrevMonth: (tenantId: string) => Promise<StoreMonthlySettingsForm | null>;
}

/** (year, month) の前月を返す（1 月 → 前年 12 月）。 */
function prevYearMonth(year: number, month: number): { year: number; month: number } {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/** auth.uid() を取得（未ログイン時 null）。 */
async function getAuthUid(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** form のフォーム数値群を行ペイロード（マスタ列のみ）に変換する。 */
function formToColumns(form: StoreMonthlySettingsForm) {
  return {
    fixed_payroll_employee: form.fixed_payroll_employee,
    rent: form.rent,
    utilities: form.utilities,
    communication: form.communication,
    advertising: form.advertising,
    other_sga_fixed: form.other_sga_fixed,
    sales_target: form.sales_target,
  };
}

/** 行 → フォーム値（前月複写プリフィル用）。 */
function rowToForm(row: StoreMonthlySettingsRow): StoreMonthlySettingsForm {
  return {
    fixed_payroll_employee: row.fixed_payroll_employee,
    rent: row.rent,
    utilities: row.utilities,
    communication: row.communication,
    advertising: row.advertising,
    other_sga_fixed: row.other_sga_fixed,
    sales_target: row.sales_target,
  };
}

const SELECT_COLS =
  'tenant_id,store_id,year,month,fixed_payroll_employee,rent,utilities,communication,advertising,other_sga_fixed,sales_target,created_by,updated_by';

export function useStoreMonthlySettings(
  tenantId: string | null,
  storeId: string | null,
  year: number | null,
  month: number | null,
): UseStoreMonthlySettingsResult {
  const [data, setData] = useState<StoreMonthlySettingsRow | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const enabled = !!tenantId && !!storeId && year != null && month != null;

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // stale クリア（B17）。
      setData(null);
      setError(null);
      try {
        const { data: rows, error: supaError } = await supabase
          .from('store_monthly_settings')
          .select(SELECT_COLS)
          .eq('tenant_id', tenantId)
          .eq('store_id', storeId)
          .eq('year', year)
          .eq('month', month)
          .limit(1);
        if (supaError) throw supaError;
        if (cancelled) return;
        const row = (rows && rows.length > 0 ? rows[0] : null) as
          | StoreMonthlySettingsRow
          | null;
        setData(row);
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useStoreMonthlySettings SELECT failed:', friendly);
          setData(null);
          setError(friendly.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [tenantId, storeId, year, month, enabled, reloadKey]);

  const saveSettings = useCallback(
    async (
      tenantId: string,
      form: StoreMonthlySettingsForm,
    ): Promise<StoreMonthlySettingsRow> => {
      if (!storeId || year == null || month == null) {
        throw new Error('月次マスタの保存に失敗しました: 店舗・年月が未確定です');
      }
      setSaving(true);
      try {
        // auth.uid() をフロントで明示セット（§4.5 論点 h／P2-1）。
        // null（未ログイン）のとき created_by/updated_by に null を送らず早期離脱。
        const uid = await getAuthUid();
        if (!uid) {
          throw new Error('ログインセッションが無効です。再度ログインしてください。');
        }
        const cols = formToColumns(form);

        // 既存有無で INSERT/UPDATE を分岐（created_by を UPDATE で上書きしない）。
        const { data: existing, error: existErr } = await supabase
          .from('store_monthly_settings')
          .select('store_id')
          .eq('tenant_id', tenantId)
          .eq('store_id', storeId)
          .eq('year', year)
          .eq('month', month)
          .limit(1);
        if (existErr) throw existErr;
        const isUpdate = !!(existing && existing.length > 0);

        let resultRows: unknown[] | null;
        if (isUpdate) {
          // UPDATE: updated_by のみ更新（created_by は据え置き）。
          const { data: rows, error: upErr } = await supabase
            .from('store_monthly_settings')
            .update({ ...cols, updated_by: uid })
            .eq('tenant_id', tenantId)
            .eq('store_id', storeId)
            .eq('year', year)
            .eq('month', month)
            .select(SELECT_COLS);
          if (upErr) throw upErr;
          resultRows = rows;
        } else {
          // INSERT: created_by + updated_by を auth.uid() でセット。
          const { data: rows, error: insErr } = await supabase
            .from('store_monthly_settings')
            .insert({
              tenant_id: tenantId,
              store_id: storeId,
              year,
              month,
              ...cols,
              created_by: uid,
              updated_by: uid,
            })
            .select(SELECT_COLS);
          if (insErr) throw insErr;
          resultRows = rows;
        }

        // RETURNING 0 件エラー化（RLS silent reject の握りつぶし防止／R4）。
        if (!resultRows || resultRows.length === 0) {
          throw new Error(
            '月次マスタの保存に失敗しました: 権限がないか、該当行が見つかりません',
          );
        }
        const row = resultRows[0] as StoreMonthlySettingsRow;
        setData(row);
        return row;
      } catch (err) {
        const friendly = formatSupabaseError(err);
        logger.error('useStoreMonthlySettings save failed:', friendly);
        setError(friendly.message);
        throw err instanceof Error ? err : new Error(friendly.message);
      } finally {
        setSaving(false);
      }
    },
    [storeId, year, month],
  );

  const copyFromPrevMonth = useCallback(
    async (tenantId: string): Promise<StoreMonthlySettingsForm | null> => {
      if (!storeId || year == null || month == null) return null;
      try {
        const { year: py, month: pm } = prevYearMonth(year, month);
        const { data: rows, error: supaError } = await supabase
          .from('store_monthly_settings')
          .select(SELECT_COLS)
          .eq('tenant_id', tenantId)
          .eq('store_id', storeId)
          .eq('year', py)
          .eq('month', pm)
          .limit(1);
        if (supaError) throw supaError;
        if (!rows || rows.length === 0) return null;
        return rowToForm(rows[0] as StoreMonthlySettingsRow);
      } catch (err) {
        const friendly = formatSupabaseError(err);
        logger.error('useStoreMonthlySettings copyFromPrevMonth failed:', friendly);
        setError(friendly.message);
        throw err instanceof Error ? err : new Error(friendly.message);
      }
    },
    [storeId, year, month],
  );

  return { data, loading, error, saving, reload, saveSettings, copyFromPrevMonth };
}
