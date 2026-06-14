-- Migration 087: shift_preferences の締切バイパス & 自己承認封鎖（P2/P3 B1）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl）:
--   shift_preferences の INSERT policy が PERMISSIVE 2 本に分かれている:
--     (a) shift_preferences_insert_self        roles={authenticated}
--           WITH CHECK = user_id=auth.uid() AND tenant_id IN (get_my_tenant_ids())
--           → 締切ガードが一切無い。
--     (b) shift_preferences_insert_with_deadline  roles=PUBLIC(=NULL)
--           WITH CHECK = user_id=auth.uid() AND tenant_id IN (get_my_tenant_ids())
--             AND ( owner/manager である
--                   OR NOT EXISTS(shift_submission_deadlines で締切超過) )
--           → 締切前 staff / owner/manager は通り、締切後 staff は弾く設計。
--   PERMISSIVE は OR 結合のため、(a) が常時 true で通ることで (b) の締切ガードが
--   完全に無効化されている（item: preference-insert-deadline-bypass）。
--
--   また UPDATE policy shift_preferences_update_self_pre_approval は
--     USING      = user_id=auth.uid() AND tenant_id IN(get_my_tenant_ids())
--                  AND ( status='pending' OR status='rejected'
--                        OR (status='approved' AND preference_type='unavailable') )
--     WITH CHECK = user_id=auth.uid() AND tenant_id IN(get_my_tenant_ids())
--   と WITH CHECK に status 遷移制約が無い。USING で pending/rejected/
--   approved-unavailable 行を掴めるため、本人が NEW.status='approved' へ
--   書き換えて preferred 希望を自己承認できてしまう（item: staff-self-approve-preference）。
--   正規の承認は shift_preferences_manager_update（owner/manager）経由に限定すべき。
--
-- 設計方針（非破壊）:
--   ① INSERT: insert_self を DROP し insert_with_deadline に一本化する。
--      ただし本番の insert_with_deadline は roles=PUBLIC（anon 含む）なので、
--      authenticated 限定へ作り直す（MEMORY 規律: anon を握らせない）。
--      締切分岐（owner/manager は締切後も可 / staff は締切前のみ）はそのまま維持。
--      → submitPreference（本人・締切前）は通り、締切後 staff の起票は WITH CHECK で阻止。
--        owner/manager の締切後起票は維持。
--   ② UPDATE: update_self_pre_approval の WITH CHECK に status 遷移制約を追加。
--      本人 UPDATE 後(NEW)の status は 'pending'/'rejected' のみに限定し、
--      'approved' への自己昇格を WITH CHECK で阻止する。
--      USING は現状維持（編集可能な対象行の範囲は変えない＝
--      approved-unavailable を本人が pending に戻す等の既存導線を壊さない）。
--      正規の approved 化は shift_preferences_manager_update（owner/manager）経由のみ。
--
-- 補足（status CHECK 制約）:
--   shift_preferences_status_check = status IN ('pending','approved','rejected')。
--   'cancelled' は許容値に存在しない（leave_requests とは異なる）。
--   よって本人 UPDATE 後の許容 status は 'pending'/'rejected' の 2 値とする
--   （設計書の「cancelled」は leave 由来の例示であり本テーブルには適用不可）。
--
-- 横串確認（SELECT/INSERT/UPDATE/DELETE 4操作）:
--   SELECT  : shift_preferences_select_self / "Managers can view all ..." → 変更なし。
--   INSERT  : insert_self DROP → insert_with_deadline(authenticated 一本) のみ。
--   UPDATE  : update_self_pre_approval(WITH CHECK 強化) / manager_update → 後者は不変。
--   DELETE  : shift_preferences_delete_self_pre_approval（pending/rejected のみ）→ 変更なし。
--
-- Depends:
--   - shift_preferences 定義 / 各 policy（037 系・shift 提出締切系 migration）
--   - get_my_tenant_ids (SECURITY DEFINER STABLE)
--   - shift_submission_deadlines テーブル
--
-- Rollback / 検証SQL: 本ファイル末尾コメント参照。

BEGIN;

-- ① INSERT 一本化 -----------------------------------------------------------
-- 締切ガード無しの insert_self を撤去（締切バイパスの本体）。
DROP POLICY IF EXISTS "shift_preferences_insert_self"          ON public.shift_preferences;
-- 締切ガード付き policy を authenticated 限定で作り直す（旧版は roles=PUBLIC で anon を含む）。
DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline" ON public.shift_preferences;

CREATE POLICY "shift_preferences_insert_with_deadline"
  ON public.shift_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      -- owner/manager は締切後も起票可
      EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_members.tenant_id = shift_preferences.tenant_id
          AND tenant_members.user_id = auth.uid()
          AND tenant_members.role = ANY (ARRAY['owner'::text, 'manager'::text])
      )
      -- もしくは当該 (store, target_month) の締切が未到来（staff の締切前起票）
      OR NOT EXISTS (
        SELECT 1 FROM public.shift_submission_deadlines d
        WHERE d.tenant_id = shift_preferences.tenant_id
          AND d.store_id = shift_preferences.store_id
          AND d.target_month = (date_trunc('month'::text, (shift_preferences.date)::timestamp with time zone))::date
          AND d.deadline_at < now()
      )
    )
  );

COMMENT ON POLICY "shift_preferences_insert_with_deadline" ON public.shift_preferences IS
  'P2/P3 B1: INSERT を締切ガード付き 1 本に一本化。staff は締切前のみ・owner/manager は締切後も可。'
  'roles=authenticated（旧 PUBLIC から修正し anon を排除）。締切バイパス(insert_self)を撤去。';

-- ② UPDATE の自己承認封鎖 ---------------------------------------------------
-- USING は現状維持し、WITH CHECK に status 遷移制約を追加して approved 自己昇格を阻止。
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
    -- 本人 UPDATE 後(NEW)の status 制約:
    --   pending / rejected は無条件可。
    --   approved は preference_type='unavailable' の場合のみ可（出勤不可は提出時に
    --   自動承認される正規仕様＝useShiftPreference.submitPreference は unavailable を
    --   status='approved' で upsert する / DB trigger でも auto-approve される）。
    --   → preferred(出勤希望) を本人が approved 化する自己承認のみを封鎖する。
    AND (
      status IN ('pending', 'rejected')
      OR (status = 'approved' AND preference_type = 'unavailable')
    )
  );

COMMENT ON POLICY "shift_preferences_update_self_pre_approval" ON public.shift_preferences IS
  'P2/P3 B1: 本人 UPDATE 後の status を pending/rejected、または approved かつ '
  'preference_type=unavailable に限定し、preferred の自己 approved(自己承認)を封鎖。'
  'USING は現状維持。preferred の正規承認は shift_preferences_manager_update(owner/manager) 経由。';

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（087 適用前=元の 2 policy 構成へ復元。手動実行）
-- =========================================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline"     ON public.shift_preferences;
--   DROP POLICY IF EXISTS "shift_preferences_update_self_pre_approval" ON public.shift_preferences;
--
--   -- 締切ガード無しの insert_self（脆弱版）を復元
--   CREATE POLICY "shift_preferences_insert_self" ON public.shift_preferences
--     FOR INSERT TO authenticated
--     WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()));
--
--   -- 締切ガード付き（旧 roles=PUBLIC）を復元
--   CREATE POLICY "shift_preferences_insert_with_deadline" ON public.shift_preferences
--     FOR INSERT
--     WITH CHECK (
--       user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids())
--       AND ( EXISTS (SELECT 1 FROM public.tenant_members
--                     WHERE tenant_members.tenant_id = shift_preferences.tenant_id
--                       AND tenant_members.user_id = auth.uid()
--                       AND tenant_members.role = ANY (ARRAY['owner','manager']))
--             OR NOT EXISTS (SELECT 1 FROM public.shift_submission_deadlines d
--                     WHERE d.tenant_id = shift_preferences.tenant_id
--                       AND d.store_id = shift_preferences.store_id
--                       AND d.target_month = (date_trunc('month', (shift_preferences.date)::timestamptz))::date
--                       AND d.deadline_at < now()) ) );
--
--   -- WITH CHECK に status 制約が無い脆弱版 UPDATE を復元
--   CREATE POLICY "shift_preferences_update_self_pre_approval" ON public.shift_preferences
--     FOR UPDATE TO authenticated
--     USING (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids())
--            AND (status='pending' OR status='rejected'
--                 OR (status='approved' AND preference_type='unavailable')))
--     WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()));
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   <STAFF_UID>/<MANAGER_UID>/<TENANT_ID>/<STORE_ID> は当該テナントの実値に置換。
--   締切超過状態の (tenant,store,target_month) を 1 件用意（shift_submission_deadlines）。
-- =========================================================================
-- -- 0. policy 構成確認（read-only）: INSERT は with_deadline 1 本のみ・roles=authenticated。
-- -- SELECT polname, polcmd,
-- --   (SELECT array_agg(rolname) FROM pg_roles WHERE oid = ANY(polroles)) AS roles
-- -- FROM pg_policy WHERE polrelid='public.shift_preferences'::regclass AND polcmd IN ('a','w') ORDER BY polname;
--
-- -- 1.(攻撃) 締切超過の月に staff が希望を INSERT → PASS=RLS 違反でエラー(行0)
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.shift_preferences (tenant_id, store_id, user_id, date, preference_type, status)
-- --     VALUES ('<TENANT_ID>','<STORE_ID>','<STAFF_UID>','<締切超過月の日付>','preferred','pending');
-- --   -- → new row violates row-level security policy が出れば PASS
-- -- ROLLBACK;
--
-- -- 2.(正常) 締切未到来の月に staff が希望を INSERT → PASS=成功(1行)
-- -- BEGIN; ...同様に締切未到来の date で INSERT ... → 1 row → PASS; ROLLBACK;
--
-- -- 3.(攻撃) staff が自分の preferred/pending 行を status='approved' へ UPDATE → PASS=RLS 違反(行0)
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.shift_preferences SET status='approved'
-- --     WHERE user_id='<STAFF_UID>' AND status='pending';  -- → 0 rows / RLS 違反 = PASS
-- -- ROLLBACK;
--
-- -- 4.(正常) manager が staff の preferred 行を status='approved' へ UPDATE → PASS=成功
-- -- BEGIN; ... manager UID で UPDATE ... → 1 row → PASS; ROLLBACK;
