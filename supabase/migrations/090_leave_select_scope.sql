-- Migration 090: leave_requests の SELECT スコープ厳格化（P2/P3 B1）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl）:
--   leave_requests の SELECT policy leave_select は
--     roles=PUBLIC / USING = tenant_id IN (SELECT get_my_tenant_ids())
--   であり、同テナントに所属する staff であれば他メンバーの有給/欠勤申請を
--   全件閲覧できてしまう（item: leave-requests-tenant-wide-select）。
--   勤怠 attendance_records は「本人 OR 管理者」スコープに既に厳格化されており、
--   leave_requests だけがテナント全体に開いている不整合がある。
--
-- 設計方針:
--   leave_select の USING を
--     user_id = auth.uid() OR is_tenant_managerial(tenant_id)
--   へ厳格化し、attendance_records と整合させる。
--   ・is_tenant_managerial(uuid) は本番に存在（SECURITY DEFINER STABLE /
--     search_path 固定 / owner|manager の EXISTS 判定）→ そのまま利用。
--   ・本人(user_id=auth.uid())は自分の申請を閲覧可。
--   ・owner/manager は当該テナントの全申請を閲覧可（承認導線・月報の人件費集計に必要）。
--   ・一般 staff は他人の leave を閲覧不可（本変更の主眼）。
--   ・roles を authenticated 限定にして anon を排除する（旧 PUBLIC から修正）。
--   ※ is_tenant_managerial は内部で tenant_members を引くため、明示的な
--     tenant_id IN(get_my_tenant_ids()) スコープを併記しなくても
--     「自分が当該テナントの owner/manager」または「自分の行」のいずれかでしか
--     行が見えない。退会テナントの自 leave 行は user_id=auth.uid() で見え得るが、
--     これは本人の過去申請の閲覧であり集計汚染を生む書込経路ではない（085 と同様の整理）。
--
-- 横串確認（leave_requests の 4 操作）:
--   SELECT : leave_select を厳格化（本 migration）。
--   INSERT : leave_insert_self（085 で本人 pending 限定済）→ 変更なし。
--   UPDATE : leave_update_self / leave_update_reviewer（085）→ 変更なし。
--   DELETE : leave_delete（013 由来）→ 変更なし。
--
-- Depends:
--   - 013（leave_requests / leave_select 定義）
--   - 085（leave INSERT/UPDATE self-approval lockdown）
--   - is_tenant_managerial(uuid) (SECURITY DEFINER STABLE)
--
-- Rollback / 検証SQL: 本ファイル末尾コメント参照。

BEGIN;

DROP POLICY IF EXISTS "leave_select" ON public.leave_requests;

CREATE POLICY "leave_select"
  ON public.leave_requests
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_tenant_managerial(tenant_id)
  );

COMMENT ON POLICY "leave_select" ON public.leave_requests IS
  'P2/P3 B1: SELECT を 本人 OR owner/manager(is_tenant_managerial) に厳格化。'
  'staff の他人 leave 閲覧を封鎖し attendance_records と整合。roles=authenticated。';

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（090 適用前=テナント全体 SELECT へ復元。手動実行）
-- =========================================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "leave_select" ON public.leave_requests;
--   CREATE POLICY "leave_select" ON public.leave_requests FOR SELECT
--     USING ( tenant_id IN (SELECT get_my_tenant_ids()) );
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   <STAFF_UID>/<MANAGER_UID> は当該テナントの実 UID に置換。
--   他 staff の leave 行が存在するテナントで検証。
-- =========================================================================
-- -- 1.(攻撃) staff が他人の leave を SELECT → PASS=自分の行のみ（他人行は 0 件）
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   SELECT user_id, count(*) FROM public.leave_requests GROUP BY user_id;
-- --   -- → user_id が '<STAFF_UID>' の 1 グループのみなら PASS。
-- -- ROLLBACK;
--
-- -- 2.(正常) manager が SELECT → PASS=同テナント全員の leave が見える
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   SELECT count(DISTINCT user_id) FROM public.leave_requests;
-- --   -- → 複数 user_id が見えれば PASS。
-- -- ROLLBACK;
