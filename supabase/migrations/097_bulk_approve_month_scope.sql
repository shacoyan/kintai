-- ============================================================
-- 097_bulk_approve_month_scope.sql
-- まとめてシフト本承認を「選択中の月だけ」に限定し、通知パリティを確保する
-- 監査 item: bulk-approve-tentative-n-plus-1
--   (ShiftPage.tsx:794-811 が件数分の RPC+通知 INSERT を直列 await / N+1)
-- オーナー決定: 表示中の月だけをまとめて本承認 + 通知は per-item と同型で維持
-- 作成日: 2026-06-15
--
-- 変更点:
--   1. 旧 approve_store_shifts_final(uuid, uuid) を DROP
--      (日付フィルタ無し=全月の tentative を承認しうる「月スコープ崩壊」を解消するため)
--   2. approve_store_shifts_final(uuid, uuid, date, date) を新設
--      - 指定期間 [p_from, p_to] (両端含む) の tentative シフトのみ approved に更新
--      - 二段階承認の不変条件 (tentative のみ→approved) を維持
--      - 054 BEFORE UPDATE トリガと非衝突 (escape hatch GUC を立てる)
--      - 権限判定を per-item approve_shift_final と同一の二段ゲートに統一
--        (= owner/manager かつ 店舗マネージャー)。is_store_manager 単独は OR 判定で
--        per-item より緩く、スタッフ店長による一括本承認 (権限昇格) を許してしまう。
--      - per-item approve_shift_final と同型の shift_approved 通知を一括 INSERT
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 旧シグネチャの撤去 (月スコープ崩壊版)
--    overload を残すと UI/誤呼出から全月承認が可能になるため明示的に DROP。
-- ============================================================
DROP FUNCTION IF EXISTS public.approve_store_shifts_final(uuid, uuid);

-- ============================================================
-- 2. RPC: approve_store_shifts_final (期間スコープ版)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_store_shifts_final(
  p_tenant_id uuid,
  p_store_id  uuid,
  p_from      date,
  p_to        date
)
RETURNS TABLE(approved_count integer, approved_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_ids   uuid[];
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 1a. 期間引数の必須・整合性チェック
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'p_from / p_to are required';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'invalid range: p_from(%) > p_to(%)', p_from, p_to;
  END IF;

  -- 2. 権限チェック: per-item approve_shift_final / reject_shift と同一の二段ゲート
  --    (= owner/manager 「かつ」店舗マネージャー)。is_store_manager 単独は内部で
  --    『tenant role IN(owner,manager)』OR『store_members.is_manager=true』の OR 判定のため、
  --    スタッフ店長 (tenant role=staff AND store.is_manager=true) が per-item では弾かれるのに
  --    一括では本承認できる権限昇格 (authz 非対称) を生む。明示的に AND へ引き締める。
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id   = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied: only owner/manager can approve shifts';
  END IF;
  IF NOT public.is_store_manager(p_tenant_id, p_store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', p_store_id;
  END IF;

  -- 3. escape hatch: 054 BEFORE UPDATE トリガを RPC 経由として通過させる
  PERFORM set_config('app.allow_direct_approve', '1', true);

  -- 4. 一括更新: 指定期間 [p_from, p_to] の tentative → approved のみ
  --    - 他店舗を絶対に巻き込まないため WHERE 句に tenant_id/store_id 両方を必須
  --    - 他月を不可触にするため date BETWEEN p_from AND p_to を必須 (月スコープ保証)
  --    - status='tentative' 限定で確定済/rejected/pending/modified/cancelled は対象外
  --    - 更新行をそのまま user_id/date 付きで取り出し、通知 INSERT に流用 (per-item パリティ)
  WITH updated AS (
    UPDATE public.shifts
    SET status      = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE tenant_id = p_tenant_id
      AND store_id  = p_store_id
      AND status    = 'tentative'
      AND date >= p_from
      AND date <= p_to
    RETURNING id, user_id, tenant_id, date
  ),
  notified AS (
    -- 5. 通知パリティ: per-item approve_shift_final と同型の shift_approved 通知を一括 INSERT
    --    title / body / link / type を per-item と完全一致させる。
    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
    SELECT u.tenant_id,
           u.user_id,
           'shift_approved',
           'シフトが承認されました',
           u.date::text || ' のシフトが承認されました',
           '/shift?date=' || u.date::text
    FROM updated u
    RETURNING 1
  )
  SELECT count(*)::integer,
         COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_count, v_ids
  FROM updated;

  -- 6. 結果返却 (承認件数 + 承認した shift id 配列)
  RETURN QUERY SELECT v_count, v_ids;
END;
$$;

-- RLS 4 行テンプレ (anon 排除 / authenticated のみ)
REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_store_shifts_final(uuid, uuid, date, date) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK 手順
-- ============================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.approve_store_shifts_final(uuid, uuid, date, date);
-- -- 054 の旧 (uuid, uuid) 版を復元する場合は 054 の該当ブロックを再 apply する。
-- COMMIT;
-- ============================================================
