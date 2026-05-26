BEGIN;

-- ============================================================
-- 066: update_shift_time RPC 改定
-- 目的: approved(本承認)済みシフトの時刻編集を許可する
-- 変更点:
--   1. approved 編集ブロック (RAISE EXCEPTION 'cannot edit approved shift') を削除
--   2. 編集可能 status チェックに 'approved' を追加
--   3. approved 編集時は status='tentative', reviewed_at/by=NULL にリセット
--   4. trigger の direct_tentative 制限を回避するため事前に set_config を実行
--   5. tentative_approved_at/by は維持 (055 パターンと同一)
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_shift_time(
  p_shift_id   uuid,
  p_start_time time,
  p_end_time   time,
  p_store_id   uuid DEFAULT NULL
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4a. 現状店舗の管理権限チェック
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of current store %', v_shift.store_id;
  END IF;

  -- 4b. 店舗振替時は振替先店舗の管理権限もチェック
  IF p_store_id IS NOT NULL AND p_store_id <> v_shift.store_id THEN
    IF NOT public.is_store_manager(v_shift.tenant_id, p_store_id) THEN
      RAISE EXCEPTION 'permission denied: not a manager of target store %', p_store_id;
    END IF;
  END IF;

  -- 5. 15分単位チェック
  IF EXTRACT(MINUTE FROM p_start_time)::int % 15 <> 0
     OR EXTRACT(SECOND FROM p_start_time)::int <> 0
     OR EXTRACT(MINUTE FROM p_end_time)::int % 15 <> 0
     OR EXTRACT(SECOND FROM p_end_time)::int <> 0 THEN
    RAISE EXCEPTION 'time must be aligned to 15-minute boundary: % - %', p_start_time, p_end_time;
  END IF;

  -- 6. 編集可能なステータスチェック (approvedを追加)
  IF v_shift.status NOT IN ('pending', 'tentative', 'modified', 'approved') THEN
    RAISE EXCEPTION 'cannot edit shift with status: %', v_shift.status;
  END IF;

  -- 7. approvedシフトを編集する場合の事前準備
  --    trigger 経由での approved → tentative 遷移を許可するエスケープハッチ
  IF v_shift.status = 'approved' THEN
    PERFORM set_config('app.allow_direct_tentative', '1', true);
  END IF;

  -- 8. 時間更新
  --    approved の場合は status='tentative' に戻し、本承認情報をクリア
  --    tentative_approved_by / tentative_approved_at は触らない (055 パターンと同一)
  UPDATE public.shifts
  SET start_time = p_start_time,
      end_time   = p_end_time,
      status = CASE WHEN v_shift.status = 'approved' THEN 'tentative' ELSE v_shift.status END,
      reviewed_by = CASE WHEN v_shift.status = 'approved' THEN NULL ELSE reviewed_by END,
      reviewed_at = CASE WHEN v_shift.status = 'approved' THEN NULL ELSE reviewed_at END,
      original_start_time = COALESCE(original_start_time, v_shift.start_time),
      original_end_time   = COALESCE(original_end_time, v_shift.end_time),
      store_id = COALESCE(p_store_id, store_id)
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 9. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_shift_time(uuid, time, time, uuid) TO authenticated;

COMMIT;
