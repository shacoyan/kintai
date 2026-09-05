-- ============================================================
-- 118_correction_requested_notify.sql
-- 勤怠修正申請（correction_requests）提出時に管理者へ in-app 通知を fan-out する
--   設計書: .company/engineering/docs/2026-09-05-kintai-ux-fixes-design.md §4.4 / §7.1
--   作成日: 2026-09-05  リスクティア: L
--
-- 背景 / なぜ:
--   管理者は「誰から修正依頼が来たか」に気づく手段が pending バッジしか無かった
--   （オーナー指示 2026-09-05・決裁①）。notifications の INSERT ポリシー
--   （028/099 notifications_insert_owner_manager）は owner/manager 限定のため、
--   staff セッションの client 直 insert（useCorrection.submitRequest）からは
--   通知行を作れない。→ AFTER INSERT トリガ（SECURITY DEFINER）で作る。
--
-- 設計の柱:
--   - RLS ポリシーは 1 本も作らない・消さない・置き換えない（4 操作横串: 変更ゼロ）。
--   - 通知は best-effort。内側 BEGIN..EXCEPTION で握り潰し、申請 INSERT は必ず成功させる
--     （114 review_correction_request の notify と同型）。
--   - 受信者 = テナントの owner/admin 全員 + 当該店舗の manager（store_members.is_manager）。
--     申請者本人は除外。店舗不明時は manager 全員（通知漏れより過通知を許容）。
--   - 035 notify_admins_of_unavailable_preference の同型トリガだが、search_path に pg_temp を
--     含め、PUBLIC/anon/authenticated から EXECUTE を剥がす（4 行テンプレ準拠）。
--
-- 冪等性:
--   DO ブロック（ドリフト検査）/ DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT /
--   CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER / REVOKE（no-op 成功）。
--   2 回適用してもエラーにならない。
--
-- ★注意: 本ファイルのどこにも（コメント内含む）行頭 BEGIN;/COMMIT;/ROLLBACK; を書かない
--   （prod-gate の dry-run ラップ BEGIN..ROLLBACK が破られるため）。
--   plpgsql の DO $$ BEGIN ... END $$; / 関数本体の BEGIN は可。
--
-- Depends on: 003/005/027 (correction_requests 列) / 015/017 (store_members.is_manager) /
--             028/035 (notifications + notifications_type_check 11 値) / 107 (admin ロール)
-- ============================================================

-- ---------------------------------------------------------------------
-- (A) notifications.type CHECK に 'correction_requested' を追加
--     ドリフト検査: 現行定義に 035 の 11 値が全て含まれ、値数が 11（未適用）or 12（適用済）で
--     あることを先に検査する。未知の値が混じっていれば RAISE（fail-closed・Tech Lead へ）。
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_expected text[] := ARRAY[
    'shift_approved','shift_rejected',
    'preference_approved','preference_rejected','preference_reverted',
    'preference_unavailable_submitted',
    'correction_approved','correction_rejected',
    'leave_approved','leave_rejected',
    'generic'
  ];
  v_val      text;
  v_count    int;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.notifications'::regclass
    AND c.conname = 'notifications_type_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '[118] notifications_type_check not found (expected 035 definition)';
  END IF;

  FOREACH v_val IN ARRAY v_expected LOOP
    IF position(quote_literal(v_val) IN v_def) = 0 THEN
      RAISE EXCEPTION '[118] notifications_type_check drift: % missing in current definition: %', v_val, v_def;
    END IF;
  END LOOP;

  -- 値数 = '::text' の出現回数
  v_count := (length(v_def) - length(replace(v_def, '::text', ''))) / length('::text');
  IF position(quote_literal('correction_requested') IN v_def) > 0 THEN
    IF v_count <> 12 THEN
      RAISE EXCEPTION '[118] notifications_type_check drift: expected 12 values (already applied) but found %: %', v_count, v_def;
    END IF;
  ELSIF v_count <> 11 THEN
    RAISE EXCEPTION '[118] notifications_type_check drift: expected 11 values but found %: %', v_count, v_def;
  END IF;
END $$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'shift_approved','shift_rejected',
    'preference_approved','preference_rejected','preference_reverted',
    'preference_unavailable_submitted',
    'correction_approved','correction_rejected',
    'leave_approved','leave_rejected',
    'generic',
    'correction_requested'
  ));

-- ---------------------------------------------------------------------
-- (B) トリガ関数（SECURITY DEFINER）
--     notifications の INSERT ポリシー（owner/manager 限定）を設計上迂回し、
--     staff 起点の通知行を作る唯一の経路。受信者決定は関数内で行う。
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins_of_correction_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store_id  uuid;
  v_name      text;
  v_kind      text;
  v_recipient uuid;
BEGIN
  -- 提出（pending）以外は対象外（将来の INSERT 経路に対する安全側）
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- 店舗解決: correction_requests.store_id → attendance_records.store_id → NULL
    v_store_id := NEW.store_id;
    IF v_store_id IS NULL AND NEW.attendance_record_id IS NOT NULL THEN
      SELECT ar.store_id INTO v_store_id
      FROM public.attendance_records ar
      WHERE ar.id = NEW.attendance_record_id
        AND ar.tenant_id = NEW.tenant_id;
    END IF;

    -- 申請者の勤務時名（display_name）。空なら 'メンバー'
    SELECT COALESCE(NULLIF(btrim(tm.display_name), ''), 'メンバー') INTO v_name
    FROM public.tenant_members tm
    WHERE tm.tenant_id = NEW.tenant_id
      AND tm.user_id = NEW.user_id
    LIMIT 1;
    v_name := COALESCE(v_name, 'メンバー');

    v_kind := CASE WHEN NEW.request_type = 'delete' THEN '打刻削除' ELSE '打刻修正' END;

    FOR v_recipient IN
      SELECT DISTINCT tm.user_id
      FROM public.tenant_members tm
      WHERE tm.tenant_id = NEW.tenant_id
        AND tm.user_id <> NEW.user_id                       -- 申請者本人は除外
        AND (
          tm.role IN ('owner', 'admin')                     -- テナント管理者は全員
          OR (
            tm.role = 'manager'
            AND (
              v_store_id IS NULL                            -- 店舗不明: manager 全員（過通知を許容）
              OR EXISTS (
                SELECT 1
                FROM public.store_members sm
                WHERE sm.member_id = tm.id
                  AND sm.store_id = v_store_id
                  AND sm.is_manager = true
              )
            )
          )
        )
    LOOP
      INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
      VALUES (
        NEW.tenant_id,
        v_recipient,
        'correction_requested',
        '勤怠修正の申請が届きました',
        v_name || ' が ' || NEW.date::text || ' の' || v_kind || 'を申請しました',
        '/admin?adminTab=corrections'
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- 通知は best-effort（114 と同型）。本処理（申請 INSERT）を落とさない。
    RAISE WARNING '[notify_admins_of_correction_request] notify failed for request %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 4 行テンプレ準拠。RETURNS trigger は直接呼出不能で、EXECUTE 権限は CREATE TRIGGER 時に
-- 所有者に対してのみ検査されるため GRANT は不要。「authenticated から直接叩かせない」意図で
-- テンプレの GRANT 行を REVOKE authenticated に置換している（設計書 §4.4）。
REVOKE ALL     ON FUNCTION public.notify_admins_of_correction_request() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_correction_request() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_correction_request() FROM authenticated;

COMMENT ON FUNCTION public.notify_admins_of_correction_request() IS
  '118: correction_requests AFTER INSERT で owner/admin 全員 + 当該店舗 manager（申請者除外）へ '
  'correction_requested 通知を fan-out。best-effort（例外は WARNING）。RLS ポリシーは不変。';

-- ---------------------------------------------------------------------
-- (C) トリガ
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_correction_requests_notify_admins ON public.correction_requests;
CREATE TRIGGER trg_correction_requests_notify_admins
  AFTER INSERT ON public.correction_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_of_correction_request();

-- ※ PostgREST スキーマキャッシュ再読込は不要（新 RPC / 列 / VIEW なし）。

-- ============================================================
-- ロールバック SQL（緊急時のみ・コメントとして記載・番号順に実行）
-- ============================================================
--   -- 1. トリガと関数を落とす
--   -- DROP TRIGGER IF EXISTS trg_correction_requests_notify_admins ON public.correction_requests;
--   -- DROP FUNCTION IF EXISTS public.notify_admins_of_correction_request();
--   --
--   -- 2. 新 type の通知行を消す（★CHECK を戻す前に必須。残っていると ADD CONSTRAINT が失敗する）
--   -- DELETE FROM public.notifications WHERE type = 'correction_requested';
--   --
--   -- 3. CHECK を 035 の 11 値に戻す
--   -- ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
--   -- ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
--   --   'shift_approved','shift_rejected',
--   --   'preference_approved','preference_rejected','preference_reverted',
--   --   'preference_unavailable_submitted',
--   --   'correction_approved','correction_rejected',
--   --   'leave_approved','leave_rejected',
--   --   'generic'
--   -- ));
--
-- ============================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。read-only / 無汚染）
-- ============================================================
--   -- 0. CHECK に新値が入り、値数 12
--   -- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   --   WHERE conrelid='public.notifications'::regclass AND conname='notifications_type_check';
--   --   -- 期待: 'correction_requested' を含む / '::text' が 12 回
--   --
--   -- 1. トリガが 1 本・有効
--   -- SELECT tgname, tgenabled FROM pg_trigger
--   --   WHERE tgrelid='public.correction_requests'::regclass AND NOT tgisinternal;
--   --   -- 期待: trg_correction_requests_notify_admins / 'O'（他の非内部トリガは無い）
--   --
--   -- 2. 関数の definer / search_path / ACL
--   -- SELECT prosecdef, proconfig FROM pg_proc
--   --   WHERE oid='public.notify_admins_of_correction_request()'::regprocedure;
--   --   -- 期待: prosecdef=true / proconfig={search_path=public, pg_temp}
--   -- SELECT has_function_privilege('anon','public.notify_admins_of_correction_request()','EXECUTE')          AS anon_exec,
--   --        has_function_privilege('authenticated','public.notify_admins_of_correction_request()','EXECUTE') AS auth_exec;
--   --   -- 期待: 両方 false
--   --
--   -- 3. RLS policy は適用前後で不変（本 migration は policy 変更ゼロ）
--   -- SELECT tablename, policyname, cmd FROM pg_policies
--   --   WHERE schemaname='public' AND tablename IN ('notifications','correction_requests')
--   --   ORDER BY tablename, policyname;
--   --   -- 期待: 適用前スナップショットと完全一致（notifications 4 / correction_requests 5）
--   --
--   -- 4. 適用直後は新 type の行が 0（dry-run の検証 INSERT は ROLLBACK 済）
--   -- SELECT count(*) FROM public.notifications WHERE type='correction_requested'; -- 期待: 0
-- ============================================================
