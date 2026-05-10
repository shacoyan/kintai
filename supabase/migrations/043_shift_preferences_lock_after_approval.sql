-- 043_shift_preferences_lock_after_approval.sql
-- 目的:
--   1. 016 由来の粗粒度 policy "Users manage own shift_preferences" (FOR ALL) を粒度別へ刷新
--   2. staff の UPDATE/DELETE に承認状態ガードを組込む
--      - approved (preference_type ≠ unavailable) は本人編集不可（承認後ロック）
--      - approved (preference_type = unavailable, 自動承認) は本人解除可
--      - rejected は再提出許可、pending は通常運用
--   3. 035 の enforce_unavailable_auto_approve() を拡張し、
--      不可 → 非不可 への変更時に status を 'pending' へ自動リセットする
--      （承認済みのまま preference_type だけ変わる不整合を防止）
--   4. SECURITY DEFINER 関数の 4 行テンプレ（search_path 固定 / REVOKE PUBLIC / REVOKE anon / GRANT authenticated）を適用
--
-- 037 (consolidated_catchup, prod 未適用) との整合:
--   037 §6 の DROP 群に下記 4 件を追記する別 PR が必要（本ファイル §3.4 末尾コメント参照）:
--     - shift_preferences_select_self
--     - shift_preferences_insert_self
--     - shift_preferences_update_self_pre_approval
--     - shift_preferences_delete_self_pre_approval
--   manager 側 UPDATE は 039 の "shift_preferences_manager_update" でカバー（本 043 は触らない）。
--   manager 側 SELECT は 017 の "Managers can view all shift_preferences" でカバー（本 043 は触らない）。

BEGIN;

-- --------------------------------------------------------------------------
-- (1) 016 由来の旧 policy を DROP（FOR ALL は粒度が粗すぎ承認後ロックを表現できない）
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own shift_preferences" ON public.shift_preferences;

-- --------------------------------------------------------------------------
-- (2) staff SELECT — 本人行のみ（manager 側は 017 で別途許可）
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
CREATE POLICY "shift_preferences_select_self"
  ON public.shift_preferences
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- --------------------------------------------------------------------------
-- (3) staff INSERT — 本人行のみ（締切ガードは P2 で復活検討、本 043 では素通し）
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "shift_preferences_insert_self" ON public.shift_preferences;
CREATE POLICY "shift_preferences_insert_self"
  ON public.shift_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- --------------------------------------------------------------------------
-- (4) staff UPDATE — 本人 + 承認前 or 不可（自動承認）解除のみ
--     状態遷移マトリクス（設計書 §3.2）:
--       pending     → 編集可
--       rejected    → 編集可（再提出シナリオ）
--       approved (unavailable)        → 編集可（不可解除を本人が行える）
--       approved (≠ unavailable)      → 編集不可（承認後ロック）
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "shift_preferences_update_self_pre_approval" ON public.shift_preferences;
CREATE POLICY "shift_preferences_update_self_pre_approval"
  ON public.shift_preferences
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      status = 'pending'
      OR status = 'rejected'
      OR (status = 'approved' AND preference_type = 'unavailable')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- --------------------------------------------------------------------------
-- (5) staff DELETE — 本人 + 承認前のみ（approved は店長操作必須）
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "shift_preferences_delete_self_pre_approval" ON public.shift_preferences;
CREATE POLICY "shift_preferences_delete_self_pre_approval"
  ON public.shift_preferences
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
    AND status IN ('pending','rejected')
  );

-- --------------------------------------------------------------------------
-- (6) 035 trigger 関数を拡張: 不可 → 非不可 への変更時に status='pending' へ自動リセット
--     既存ロジック（preference_type='unavailable' の自動承認）は完全保持。
--     SECURITY DEFINER ではないが、search_path を固定してオブジェクト解決の予測可能性を担保。
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_unavailable_auto_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- (a) 不可は強制承認（既存ロジック温存）
  IF NEW.preference_type = 'unavailable' THEN
    NEW.status := 'approved';
    RETURN NEW;
  END IF;

  -- (b) UPDATE で 不可 → 非不可 へ変更されかつ approved のままの場合、pending にリセット
  --     （approvePreference 経路で shifts は未作成のため shifts 連動 cleanup は不要）
  IF TG_OP = 'UPDATE'
     AND OLD.preference_type = 'unavailable'
     AND NEW.preference_type <> 'unavailable'
     AND NEW.status = 'approved'
  THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- trigger 自体は 035 で既に BEFORE INSERT OR UPDATE で登録済み。CREATE OR REPLACE FUNCTION で
-- 関数本体のみ差し替えれば trigger は新ロジックを参照する。再 CREATE TRIGGER は不要だが、
-- 冪等性確保のため DROP IF EXISTS + CREATE を再実行する（035 と同形）。
DROP TRIGGER IF EXISTS trg_shift_preferences_auto_approve ON public.shift_preferences;
CREATE TRIGGER trg_shift_preferences_auto_approve
  BEFORE INSERT OR UPDATE ON public.shift_preferences
  FOR EACH ROW EXECUTE FUNCTION enforce_unavailable_auto_approve();

-- --------------------------------------------------------------------------
-- (7) SECURITY DEFINER 関数の 4 行テンプレ適用
--     enforce_unavailable_auto_approve() は SECURITY DEFINER ではないが、
--     search_path 固定済（上記 (6) で SET search_path = public, pg_temp）。
--     042 で notify_admins_of_unavailable_preference() に対し PUBLIC/anon REVOKE 済のため、
--     本 043 では再適用は不要だが、防御的に再宣言（冪等）。
-- --------------------------------------------------------------------------
ALTER FUNCTION public.notify_admins_of_unavailable_preference()
  SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_unavailable_preference() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_unavailable_preference() FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_admins_of_unavailable_preference() TO authenticated;

-- enforce_unavailable_auto_approve は trigger 関数（owner=postgres 実行）。
-- 直接呼出経路は無いが、防御的に PUBLIC/anon の EXECUTE を明示遮断する。
REVOKE EXECUTE ON FUNCTION public.enforce_unavailable_auto_approve() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_unavailable_auto_approve() FROM anon;

COMMIT;

-- ==========================================================================
-- ROLLBACK 手順 (apply 後の緊急切戻し用、本ファイルでは実行しない)
-- ==========================================================================
-- BEGIN;
--
-- DROP POLICY IF EXISTS "shift_preferences_delete_self_pre_approval" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_update_self_pre_approval" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_insert_self" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
--
-- CREATE POLICY "Users manage own shift_preferences"
--   ON public.shift_preferences
--   FOR ALL
--   TO authenticated
--   USING (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()))
--   WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()));
--
-- -- 035 の trigger 関数を元のシンプル版へ戻す
-- CREATE OR REPLACE FUNCTION enforce_unavailable_auto_approve()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.preference_type = 'unavailable' THEN
--     NEW.status := 'approved';
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- COMMIT;

-- ==========================================================================
-- 037 整合 — 別 PR で 037 §6 DROP 群へ追記する内容（参考）
-- ==========================================================================
-- DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_insert_self" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_update_self_pre_approval" ON public.shift_preferences;
-- DROP POLICY IF EXISTS "shift_preferences_delete_self_pre_approval" ON public.shift_preferences;
