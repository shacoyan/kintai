-- Migration 085: leave_requests 自己承認封鎖（P1-2）
--
-- 背景:
--   本番に残る policy "leave_update"（013 由来 / 017 で再定義）は
--     cmd=UPDATE / roles={public}
--     USING = tenant_id IN (get_my_tenant_ids())
--             AND (user_id=auth.uid() OR is_tenant_owner(tenant_id)
--                  OR EXISTS(... role IN('owner','manager')))
--     WITH CHECK = NULL
--   である。Postgres は UPDATE policy の WITH CHECK が省略されると USING を
--   新行(NEW)にも適用するため、本人行は USING(user_id=auth.uid()) を満たし、
--   staff が自分の pending 行を {status:'approved', reviewed_by:自分} へ書換え＝
--   有給を自己承認できてしまう（有給残数 / 月報の人件費が改ざんされる）。
--
-- 設計方針（非破壊）:
--   "leave_update" を DROP し、PERMISSIVE な FOR UPDATE policy 2 本に分割する
--   （PERMISSIVE は OR 結合 = いずれかを満たせば通る）。
--     (1) leave_update_self     … 本人 かつ 自アクティブテナント所属(tenant_id IN get_my_tenant_ids())
--                                  かつ USING で status='pending' に限定（本人が触れる対象行は pending のみ）。
--                                  WITH CHECK で NEW.status を pending/cancelled、かつ
--                                  reviewed_by/reviewed_at IS NULL に限定。
--                                  → cancelLeave(pending→cancelled) は通り、approved/rejected への
--                                    自己昇格、approved→cancelled/pending の自己降格（有給残数復活・
--                                    レビュー痕跡消去）はいずれも USING/WITH CHECK 違反で阻止。
--                                  ※ 旧 leave_update が持っていた tenant_id IN(get_my_tenant_ids())
--                                    スコープを self path でも維持する（退会済テナントの自 leave 行を
--                                    pending⇔cancelled に切替えて集計汚染する経路を遮断。
--                                    get_my_tenant_ids は deleted_at IS NULL のアクティブテナントのみ返す）。
--     (2) leave_update_reviewer … owner/manager。USING/WITH CHECK とも owner/manager 限定。
--                                  → approveLeave / rejectLeave（status=approved/rejected,
--                                    reviewed_by/reviewed_at 書込）が従来どおり通る。
--   SELECT(leave_select) / DELETE(leave_delete) policy には一切触れない（DROP しない）。
--   INSERT(leave_insert) は当初対象外としたが、Reviewer round3 の blocking 指摘により
--   self/reviewer の 2 本へ分割する（COMMIT 直前のブロック参照）。UPDATE だけ塞いで INSERT を
--   残すと status='approved' 直 INSERT による自己承認が片側取り残しになるため。
--
-- 列 GRANT は変更不要:
--   自己承認の封鎖は WITH CHECK の status 制約で十分（staff は approved/rejected の
--   NEW 行を書けない＝列値そのものを RLS で拒否できる）。tenant_members のような
--   identity 列差し替え（NEW.user_id 改変による招待迂回）は leave_requests には無く、
--   user_id を別ユーザーへ書き換えても USING(user_id=auth.uid()) と
--   WITH CHECK(user_id=auth.uid()) の両方で弾かれるため列権限ガードは不要。
--
-- 前提（実測済 2026-06-14）:
--   - 本番 leave_update = cmd UPDATE / roles {public} / WITH CHECK NULL（上記のとおり）
--   - get_my_tenant_ids / is_tenant_owner = SECURITY DEFINER STABLE
--   - leave_requests.status CHECK = ('pending','approved','rejected','cancelled')
--
-- Depends:
--   - 013 (leave_requests 定義 / leave_select・leave_insert・leave_delete)
--   - 017 (leave_update 再定義 ← 本 migration で置換)
--
-- Rollback / 検証SQL: 本ファイル末尾のコメントブロックを参照。

BEGIN;

-- 脆弱な単一 UPDATE policy を撤去（013/017 由来。WITH CHECK 欠落が自己承認の穴）
DROP POLICY IF EXISTS "leave_update" ON public.leave_requests;
-- 念のため過去版の名残も掃除（idempotent / 存在しなくても無害）
DROP POLICY IF EXISTS "leave_update_self" ON public.leave_requests;
DROP POLICY IF EXISTS "leave_update_reviewer" ON public.leave_requests;

-- (1) 本人用 UPDATE policy:
--   USING      … 本人行 かつ 自アクティブテナント所属 かつ status='pending' のみ対象
--                （approved/rejected 行は本人には一切見えない＝自己降格 approved→cancelled/pending を遮断）
--   WITH CHECK … 自アクティブテナント所属 + 本人 + 更新後(NEW)の status を 'pending'/'cancelled'
--                に限定 + reviewed_by/reviewed_at IS NULL（レビュー痕跡偽装も阻止）。
--                本人による approved/rejected への昇格を阻止。
--   tenant_id IN (SELECT get_my_tenant_ids()) … 旧 leave_update のテナントスコープを self path で維持。
--                退会済(get_my_tenant_ids 外)ユーザーが行 id を知っていても自 leave 行を
--                pending⇔cancelled に切替えられない（退会テナントの集計汚染を遮断）。
-- → cancelLeave（pending→cancelled, 本人・アクティブテナント）は通る。自己承認は WITH CHECK 違反で ERROR。
CREATE POLICY "leave_update_self"
  ON public.leave_requests
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
    AND status = 'pending'
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
    AND status IN ('pending', 'cancelled')
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

COMMENT ON POLICY "leave_update_self" ON public.leave_requests IS
  'P1-2 fix: 本人は自分の申請を pending/cancelled にしか遷移できない。'
  'approved/rejected への自己承認(自己昇格)を WITH CHECK で封鎖。';

-- (2) レビュー権限者用 UPDATE policy（owner/manager 限定）:
--   USING/WITH CHECK とも owner/manager かつ自テナント。status 制約は付けない
--   （承認導線は approved/rejected/pending いずれへも遷移できる必要があるため）。
-- → approveLeave / rejectLeave（reviewed_by/reviewed_at 書込含む）が通る。
CREATE POLICY "leave_update_reviewer"
  ON public.leave_requests
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = leave_requests.tenant_id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner', 'manager')
      )
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = leave_requests.tenant_id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner', 'manager')
      )
    )
  );

COMMENT ON POLICY "leave_update_reviewer" ON public.leave_requests IS
  'P1-2 fix: 正規の承認/却下は owner/manager のみ。approved/rejected/reviewed_by/'
  'reviewed_at の書込はこの policy 経由（自テナント限定）。';

-- =========================================================================
-- INSERT 経路の自己承認封鎖（Reviewer round3 blocking 指摘）:
--   013 由来の "leave_insert" は WITH CHECK = tenant_id IN(get_my_tenant_ids())
--   AND user_id=auth.uid() のみで status 制約が無い。staff が PostgREST を直接叩き
--     INSERT INTO leave_requests(..., status='approved', reviewed_by=自分, reviewed_at=now())
--   を実行すると、UPDATE を経由せず最初から approved な自 leave 行を作れてしまい、
--   UPDATE だけ塞いだ本 migration の意図（leave 自己承認の封鎖）が片側取り残しになる。
--   → "leave_insert" を DROP し、UPDATE と対称な self / reviewer の 2 本に分割する。
--     (1) leave_insert_self     … 本人 INSERT は status='pending' AND reviewed_by IS NULL
--                                  AND reviewed_at IS NULL を強制。
--                                  → submitLeave（status 未指定=DB default 'pending',
--                                    reviewed_by/at 未指定=NULL）は通り、status='approved'/'rejected'
--                                    や reviewed_by 付き直 INSERT は WITH CHECK 違反で阻止。
--   ※ round4 blocking: 当初の leave_insert_reviewer（owner/manager 任意 status INSERT）は
--     NEW.user_id の自テナント所属を検証せず、所属外 UUID の leave 行を任意 status で起票でき
--     月報/有給集計を汚染する攻撃面となるため撤去。INSERT は leave_insert_self の 1 本のみ。
--     承認/却下は leave_update_reviewer 経由で行うため代理起票導線は不要。
DROP POLICY IF EXISTS "leave_insert"          ON public.leave_requests;
DROP POLICY IF EXISTS "leave_insert_self"     ON public.leave_requests;
DROP POLICY IF EXISTS "leave_insert_reviewer" ON public.leave_requests;

-- (1) 本人用 INSERT policy: 自テナント + 本人 + pending かつ未レビュー(NEW)に限定
CREATE POLICY "leave_insert_self"
  ON public.leave_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

COMMENT ON POLICY "leave_insert_self" ON public.leave_requests IS
  'P1-2 fix(round3): 本人の INSERT は status=pending かつ未レビューに限定。'
  'status=approved/rejected や reviewed_by 付きの直 INSERT による自己承認(INSERT 経路)を封鎖。';

-- ※ leave_insert_reviewer は round4 blocking 指摘により撤去（本 migration では CREATE しない）:
--   owner/manager 用の任意 status INSERT は NEW.user_id の自テナント所属を検証しておらず、
--   かつフロント正規導線（submitLeave=本人のみ）で未使用のため攻撃面のみが残る。
--   owner/manager が所属外の任意 UUID の leave 行を任意 status で自テナントに起票でき、
--   月報/有給集計を汚染できる経路となるため、INSERT は leave_insert_self の 1 本に限定する。
--   （承認/却下は leave_update_reviewer 経由で行うため代理起票導線が無くても業務上問題ない）。
-- 念のため過去版の名残も掃除（idempotent / 存在しなくても無害）。
DROP POLICY IF EXISTS "leave_insert_reviewer" ON public.leave_requests;

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（085 を適用前=元の単一 leave_update へ正確復元する。手動実行）
-- =========================================================================
-- BEGIN;
--
-- DROP POLICY IF EXISTS "leave_update_self"     ON public.leave_requests;
-- DROP POLICY IF EXISTS "leave_update_reviewer" ON public.leave_requests;
-- DROP POLICY IF EXISTS "leave_insert_self"     ON public.leave_requests;
-- DROP POLICY IF EXISTS "leave_insert_reviewer" ON public.leave_requests;
--
-- -- 017 由来の脆弱版（WITH CHECK 無し / roles=public）を復元
-- CREATE POLICY "leave_update" ON public.leave_requests FOR UPDATE
--   USING (
--     tenant_id IN (SELECT get_my_tenant_ids())
--     AND (
--       user_id = auth.uid()
--       OR is_tenant_owner(tenant_id)
--       OR EXISTS (
--         SELECT 1 FROM public.tenant_members
--         WHERE tenant_id = leave_requests.tenant_id
--           AND user_id = auth.uid()
--           AND role IN ('owner', 'manager')
--       )
--     )
--   );
--
-- -- 013 由来の脆弱版 leave_insert（status 制約なし）を復元
-- CREATE POLICY "leave_insert" ON public.leave_requests FOR INSERT
--   WITH CHECK (
--     tenant_id IN (SELECT get_my_tenant_ids())
--     AND user_id = auth.uid()
--   );
--
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。BEGIN..ROLLBACK で無汚染）
--   fixture テナント候補: 786f041f-4d89-4d5e-bf1b-b4c23dd38b0c（owner1/manager2/staff7）
--                        または 6650e979-1777-44f4-a01b-a1752a37f92c（owner1/manager2/staff10）
--   <OWNER_UID>/<MANAGER_UID>/<STAFF_UID> は当該テナントの実 UID に置換。
--   検証用に staff 本人の pending 行 1 件を事前に用意（無ければ INSERT を BEGIN..ROLLBACK 内で）。
-- =========================================================================
-- -- 0. policy が想定どおり置換されたか（read-only）
-- -- SELECT policyname, cmd, roles, qual, with_check
-- -- FROM pg_policies WHERE tablename='leave_requests' ORDER BY cmd, policyname;
-- -- 期待: UPDATE=leave_update_self・leave_update_reviewer の 2 本 /
-- --       INSERT=leave_insert_self の 1 本のみ（leave_insert / leave_insert_reviewer は撤去）/
-- --       SELECT=leave_select・DELETE=leave_delete は不変。
--
-- -- 1.(攻撃) staff が自分の pending → status='approved', reviewed_by=自分 → PASS=WITH CHECK 違反 ERROR or 0行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests
-- --     SET status='approved', reviewed_by='<STAFF_UID>', reviewed_at=now()
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='pending';
-- -- ROLLBACK;
--
-- -- 2.(正規) staff が自分の pending → status='cancelled'（cancelLeave 相当）→ PASS=1行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests SET status='cancelled'
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='pending';
-- -- ROLLBACK;
--
-- -- 3.(正規) owner/manager が他人(staff)の pending → status='approved', reviewed_by/at → PASS=1行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests
-- --     SET status='approved', reviewed_by='<MANAGER_UID>', reviewed_at=now()
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='pending';
-- -- ROLLBACK;
--
-- -- 4.(正規) owner/manager が他人(staff)の pending → status='rejected'（rejectLeave 相当）→ PASS=1行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<OWNER_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests
-- --     SET status='rejected', reviewed_by='<OWNER_UID>', reviewed_at=now()
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='pending';
-- -- ROLLBACK;
--
-- -- 5.(攻撃/Reviewer指摘) 退会済(get_my_tenant_ids 外)の staff が自 leave 行を pending→cancelled に切替え → PASS=0行
-- --    準備: <LEFT_STAFF_UID> = 当該テナントに過去 leave 行を持つが現在 tenant_members 行が無い
-- --          (= get_my_tenant_ids に当該 tenant_id が含まれない) ユーザー。
-- --          無ければ BEGIN..ROLLBACK 内で staff を tenant_members から DELETE して再現してもよい。
-- --    期待: tenant_id IN (SELECT get_my_tenant_ids()) を満たさず USING で行が見えない → 影響 0 行。
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<LEFT_STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests SET status='cancelled'
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<LEFT_STAFF_UID>' AND status='pending';
-- --   -- 期待: UPDATE 0
-- -- ROLLBACK;
--
-- -- 6.(攻撃/Reviewer round3) staff が status='approved'+reviewed_by=自分 で直 INSERT → PASS=WITH CHECK 違反 ERROR
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.leave_requests(tenant_id,user_id,date,leave_type,status,reviewed_by,reviewed_at)
-- --     VALUES('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STAFF_UID>','2099-01-01','paid','approved','<STAFF_UID>',now());
-- --   -- 期待: new row violates row-level security policy (WITH CHECK) で ERROR
-- -- ROLLBACK;
--
-- -- 7.(正規) staff が status 未指定で INSERT（submitLeave 相当, DB default 'pending' / reviewed_* NULL）→ PASS=1行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.leave_requests(tenant_id,user_id,date,leave_type)
-- --     VALUES('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STAFF_UID>','2099-01-02','paid');
-- --   -- 期待: INSERT 1（leave_insert_self を満たす）
-- -- ROLLBACK;
--
-- -- 8.(攻撃/round4) staff が自分の approved 行を status='cancelled' へ自己降格（有給残数復活）→ PASS=0行
-- --    USING の status='pending' で approved 行が見えないため影響 0 行。
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests SET status='cancelled'
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='approved';
-- --   -- 期待: UPDATE 0
-- -- ROLLBACK;
--
-- -- 9.(攻撃/round4) staff が自分の approved 行を status='pending', reviewed_by=NULL へ自己降格（痕跡消去）→ PASS=0行
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<STAFF_UID>','role','authenticated')::text, true);
-- --   UPDATE public.leave_requests SET status='pending', reviewed_by=NULL, reviewed_at=NULL
-- --     WHERE tenant_id='786f041f-4d89-4d5e-bf1b-b4c23dd38b0c' AND user_id='<STAFF_UID>' AND status='approved';
-- --   -- 期待: UPDATE 0（USING で approved 行が見えない）
-- -- ROLLBACK;
--
-- -- 10.(攻撃/round4) owner/manager が所属外 UUID の leave 行を起票 → PASS=WITH CHECK 違反 ERROR
-- --     leave_insert_reviewer を撤去したため owner/manager でも leave_insert_self（user_id=auth.uid()）
-- --     を満たさず他人 UUID の起票は不可。
-- -- BEGIN;
-- --   SET LOCAL role authenticated;
-- --   SELECT set_config('request.jwt.claims', json_build_object('sub','<MANAGER_UID>','role','authenticated')::text, true);
-- --   INSERT INTO public.leave_requests(tenant_id,user_id,date,leave_type)
-- --     VALUES('786f041f-4d89-4d5e-bf1b-b4c23dd38b0c','<STAFF_UID>','2099-01-03','paid');
-- --   -- 期待: new row violates row-level security policy (WITH CHECK) で ERROR
-- -- ROLLBACK;
