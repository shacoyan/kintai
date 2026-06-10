import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { useTenant } from '../contexts/TenantContext';
import { adaptDailyReport, formToDailyReportRow } from '../lib/reports/dailyReportAdapter';
import type { DailyReport, DailyReportForm } from '../lib/reports/types';

// =============================================================================
// useDailyReport — 日報の取得 + 保存（Loop D）
// -----------------------------------------------------------------------------
// 設計書 §1.1 / §1.8 / §1.9 / §4.2 / §4.5。
//
//   - 取得: public スキーマの `supabase.rpc('get_daily_report', {...})` で取得。
//     ⚠️ supabaseSquare / withSquareSession は使わない（R8）。新 RPC は public 側で、
//     内部で square_dashboard を SECURITY DEFINER 呼びするためフロントは public
//     クライアントが正しい解決先。
//   - storeId / businessDate が揃ったときだけフェッチ（fail-closed）。
//   - 引数変更時は即 data=null（SalesPage B17 の stale クリア・R6）。
//   - 保存: daily_reports へ upsert ではなく report_exists で INSERT / UPDATE を
//     分岐（R3: UPDATE 時に created_by を上書きしない）。両経路とも `.select()`
//     RETURNING を取り、0 件なら RLS 0 行無音 success を握りつぶさずエラー化（R4）。
//   - created_by（INSERT のみ）/ updated_by（常に）に auth.uid() をフロントセット（§4.5）。
// =============================================================================

export interface UseDailyReportResult {
  data: DailyReport | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  reload: () => void;
  /** 日報を保存する（INSERT/UPDATE 自動分岐）。成功で reload。失敗は throw。 */
  saveDailyReport: (form: DailyReportForm) => Promise<void>;
}

export function useDailyReport(
  storeId: string | null,
  businessDate: string | null
): UseDailyReportResult {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;

  const [data, setData] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // reload トリガ。
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // 最新の data を保存処理から参照するための ref（report_exists 判定用）。
  const dataRef = useRef<DailyReport | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;

    if (!storeId || !businessDate) {
      // 引数未確定: フェッチせず stale クリア。
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      // B17: 引数変更時に旧 data を即クリア（他店/別日データの1フレーム残存防止・R6）。
      setData(null);
      setError(null);
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_daily_report', {
          p_store_id: storeId,
          p_business_date: businessDate,
        });
        if (rpcError) throw rpcError;
        if (cancelled) return;
        setData(adaptDailyReport(rpcData));
      } catch (err) {
        if (!cancelled) {
          const friendly = formatSupabaseError(err);
          logger.error('useDailyReport RPC failed:', friendly);
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
  }, [storeId, businessDate, reloadKey]);

  const saveDailyReport = useCallback(
    async (form: DailyReportForm) => {
      if (!tenantId || !storeId || !businessDate) {
        throw new Error('テナント・店舗・日付が確定していません');
      }

      setSaving(true);
      try {
        // auth.uid() をフロントで明示セット（§4.5 論点 h 対応）。
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        const uid = authData?.user?.id;
        if (!uid) throw new Error('ログインセッションが無効です。再度ログインしてください。');

        const row = formToDailyReportRow(form);
        const reportExists = dataRef.current?.manual.report_exists === true;

        let resultRows: unknown[] | null = null;
        let mutateError: unknown = null;

        if (reportExists) {
          // UPDATE: created_by は触らず updated_by のみ自分に（監査列の作成者保持・R3）。
          const { data: updated, error: updErr } = await supabase
            .from('daily_reports')
            .update({ ...row, updated_by: uid })
            .eq('tenant_id', tenantId)
            .eq('store_id', storeId)
            .eq('business_date', businessDate)
            .select();
          resultRows = updated;
          mutateError = updErr;
        } else {
          // INSERT: created_by / updated_by とも自分。
          const { data: inserted, error: insErr } = await supabase
            .from('daily_reports')
            .insert({
              ...row,
              tenant_id: tenantId,
              store_id: storeId,
              business_date: businessDate,
              created_by: uid,
              updated_by: uid,
            })
            .select();
          resultRows = inserted;
          mutateError = insErr;
        }

        if (mutateError) throw mutateError;
        // RLS 0 行無音 success の罠回避（R4）: RETURNING 0 件は権限エラー扱い。
        if (!resultRows || resultRows.length === 0) {
          throw new Error('保存できませんでした（権限がない可能性があります）');
        }

        // 保存後に再取得（違算等を最新 Square で再計算）。
        reload();
      } catch (err) {
        const friendly = formatSupabaseError(err);
        logger.error('useDailyReport save failed:', friendly);
        // 上位（フォーム）でトースト表示するため全文メッセージで rethrow。
        throw new Error(friendly.message);
      } finally {
        setSaving(false);
      }
    },
    [tenantId, storeId, businessDate, reload]
  );

  return { data, loading, error, saving, reload, saveDailyReport };
}
