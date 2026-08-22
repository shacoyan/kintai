-- ============================================================
-- 117_member_legal_name_kana.sql
-- tenant_members にフリガナ（legal_name_kana）を追加 +
-- tenant_members_visible の CASE マスク拡張 + complete_onboarding_v2 新設
--   設計書: .company/engineering/docs/2026-08-22-kintai-signup-profile-design.md
--   作成日: 2026-08-22  リスクティア: L
--
-- 背景 / なぜ:
--   新規登録時に「本名 / フリガナ / 勤務時名」を取得する要件（オーナー決裁 2026-08-22）。
--   フリガナは労務・給与振込用の機微情報であり legal_name と同格に扱う
--   （本人 OR owner/admin/manager のみ可視）。117 以前に参加した既存メンバーの
--   legal_name_kana は NULL（未入力）のままとし、後追い入力は強制しない。
--
-- 依存:
--   - 037 §12 B: tenant_members の列レベル権限（REVOKE SELECT ON tenant_members FROM authenticated）
--   - 061 / 082: GRANT SELECT(...) / GRANT UPDATE(...) の列リスト（★本ファイルは書き換えない）
--   - 115: tenant_members_visible の definer 化（security_invoker=false）+ CASE マスク + (D) VIEW 書込封鎖
--
-- 設計の柱:
--   - additive 列のみ。RLS policy は 1 つも作らない・消さない・置き換えない
--     （tenant_members の SELECT/INSERT/UPDATE/DELETE 4 policy は既存のまま正しい）。
--   - 新列は authenticated / anon に SELECT も UPDATE も与えない。読取は VIEW 経由のみ、
--     書込は SECURITY DEFINER の complete_onboarding_v2 経由のみ。
--   - 旧 complete_onboarding(uuid,text,text) は DDL せず COMMENT のみ（デプロイ窓の後方互換）。
--
-- 冪等性:
--   ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE VIEW / CREATE OR REPLACE FUNCTION /
--   REVOKE（no-op 成功）/ GRANT（冪等）/ COMMENT のみ。2 回適用してもエラーにならない。
--
-- ★注意: 本ファイルのどこにも（コメント内含む）行頭 BEGIN;/COMMIT;/ROLLBACK; を書かない
--   （prod-gate の dry-run ラップ BEGIN..ROLLBACK が破られるため）。
--   plpgsql の DO $$ BEGIN ... END $$; / 関数本体の BEGIN は可
--   （セミコロン付き単独行として現れないため）。
-- ============================================================

-- ---------------------------------------------------------------------
-- (A) 列追加
-- ---------------------------------------------------------------------
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS legal_name_kana TEXT NULL;

COMMENT ON COLUMN public.tenant_members.legal_name_kana IS
  'フリガナ（労務・給与振込用）。legal_name と同格の機微情報＝本人と owner/admin/manager のみ可視。'
  'NULL は未入力（117 以前に参加した既存メンバー。後追い入力は強制しない）。文字種制限なし（trim のみ）。';

-- ---------------------------------------------------------------------
-- (B) 列レベル権限
--     037 §12 B で REVOKE SELECT ON tenant_members FROM authenticated 済のため
--     新列は既定で権限ゼロだが、意図を明示宣言する（多層防御）。
--     ★ GRANT SELECT (...) / GRANT UPDATE (...) の列リスト（037 §12 B / 061 / 082）は
--       一切書き換えない。legal_name_kana はそれらに追加しない。
-- ---------------------------------------------------------------------
REVOKE SELECT (legal_name_kana) ON public.tenant_members FROM authenticated;
REVOKE SELECT (legal_name_kana) ON public.tenant_members FROM anon;
REVOKE UPDATE (legal_name_kana) ON public.tenant_members FROM authenticated;
REVOKE UPDATE (legal_name_kana) ON public.tenant_members FROM anon;

-- ---------------------------------------------------------------------
-- (C) tenant_members_visible を CREATE OR REPLACE
--     115 の 16 列を名前・順序・型（NULL::text / NULL::integer / NULL::numeric(4,1)）
--     まで完全維持し、末尾（is_parttime の後）に 17 列目 legal_name_kana を追加。
--     legal_name_kana の CASE は legal_name と完全同一条件。
--     security_invoker = false（definer 化）と VIEW 内テナントスコープを維持。
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.tenant_members_visible
WITH (security_invoker = false) AS
  SELECT
    tm.id,
    tm.tenant_id,
    tm.user_id,
    tm.role,
    tm.display_name,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.legal_name
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.legal_name
      ELSE NULL::text
    END AS legal_name,
    tm.onboarded_at,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.hourly_rate
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.hourly_rate
      ELSE NULL::integer
    END AS hourly_rate,
    tm.night_shift_enabled,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.pay_type
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.pay_type
      ELSE NULL::text
    END AS pay_type,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.monthly_salary
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.monthly_salary
      ELSE NULL::integer
    END AS monthly_salary,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.paid_leave_days
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.paid_leave_days
      ELSE NULL::numeric(4,1)
    END AS paid_leave_days,
    tm.role_id,
    tm.created_at,
    tm.is_parttime,
    CASE
      WHEN tm.user_id = auth.uid() THEN tm.legal_name_kana
      WHEN public.is_tenant_managerial(tm.tenant_id) THEN tm.legal_name_kana
      ELSE NULL::text
    END AS legal_name_kana
  FROM public.tenant_members tm
  WHERE tm.tenant_id IN (SELECT public.get_my_tenant_ids());

COMMENT ON VIEW public.tenant_members_visible IS
  'FG4 v2(115)+117: definer 化(security_invoker=false)。VIEW 内で get_my_tenant_ids() により '
  'テナントスコープを担保し、legal_name/legal_name_kana/pay4 列は「本人 OR is_tenant_managerial(admin 含む)→値, '
  'else NULL」の CASE でマスク。基底 pay4/legal_name/legal_name_kana 列 SELECT は REVOKE 済のため VIEW 経由のみ可視。';

-- 新列を含めて VIEW 全列を authenticated が読めることを保証する（フロントは select('*') で読む）。
GRANT SELECT ON public.tenant_members_visible TO authenticated;

-- 115(D) の再宣言。本 migration が VIEW を CREATE OR REPLACE するため、
-- auto-updatable ビュー経由の書込/削除穴（基底 RLS バイパス）封鎖を同一 migration 内で再保証する。
REVOKE INSERT, UPDATE, DELETE ON public.tenant_members_visible FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.tenant_members_visible FROM anon;

-- ---------------------------------------------------------------------
-- (D) complete_onboarding_v2 新設（SECURITY DEFINER）
--     complete_onboarding(uuid,text,text) の後継。フリガナ引数を追加。
--     上限はクライアント側と同値（legal 50 / kana 50 / display 30）。
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_onboarding_v2(
  p_tenant_id UUID,
  p_legal_name TEXT,
  p_legal_name_kana TEXT,
  p_display_name TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_kana    TEXT := NULLIF(btrim(p_legal_name_kana), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_legal_name IS NULL OR length(btrim(p_legal_name)) = 0 THEN
    RAISE EXCEPTION 'legal name required';
  END IF;
  IF length(btrim(p_legal_name)) > 50 THEN
    RAISE EXCEPTION 'legal name too long';
  END IF;
  IF v_kana IS NOT NULL AND length(v_kana) > 50 THEN
    RAISE EXCEPTION 'legal name kana too long';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display name required';
  END IF;
  IF length(btrim(p_display_name)) > 30 THEN
    RAISE EXCEPTION 'display name too long';
  END IF;

  UPDATE public.tenant_members
    SET legal_name      = btrim(p_legal_name),
        -- NULL / 空文字が渡された場合は既存値を保持する（誤消去防止）。
        legal_name_kana = COALESCE(v_kana, legal_name_kana),
        display_name    = btrim(p_display_name),
        onboarded_at    = COALESCE(onboarded_at, now())
    WHERE tenant_id = p_tenant_id
      AND user_id   = v_user_id;

  -- mutate 0 行を success にしない（安全ゲート #4）。
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.complete_onboarding_v2(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_onboarding_v2(UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_v2(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.complete_onboarding_v2(UUID, TEXT, TEXT, TEXT) IS
  '初回オンボーディング（117）。complete_onboarding(uuid,text,text) の後継。フリガナを追加し、'
  'p_legal_name_kana が NULL/空なら既存値を保持する。auth.uid() 自身の行のみ更新・0 行は例外。';

-- ---------------------------------------------------------------------
-- (E) 旧 complete_onboarding は deprecated コメントのみ（DDL しない）
--     CREATE OR REPLACE / DROP は禁止。DB 先行適用→コード後続デプロイの窓で
--     旧フロント（v1 を呼ぶ）が動き続ける必要があるため。
-- ---------------------------------------------------------------------
COMMENT ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT) IS
  '【非推奨 / 117 以降】complete_onboarding_v2(uuid,text,text,text) を使うこと。'
  'DB 先行適用→コード後続デプロイの窓で旧フロントを動かすためだけに残置。フリガナは更新しない。';

-- ---------------------------------------------------------------------
-- PostgREST スキーマキャッシュ再読込（列追加 / VIEW 定義 / 新 RPC を即時反映）
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ロールバック SQL（緊急時のみ・コメントとして記載）
-- ============================================================
--   -- 1. VIEW を 115 の 16 列版へ戻す（117 の CASE 追加を外す）
--   --    ※ 115_pay_read_leak_lockdown_v2.sql の (A) ブロックをそのまま再適用する。
--   --       その後 GRANT SELECT ON public.tenant_members_visible TO authenticated; と
--   --       115(D) の REVOKE 2 行を再宣言すること。
--   --
--   -- 2. 新 RPC を落とす
--   -- DROP FUNCTION IF EXISTS public.complete_onboarding_v2(uuid, text, text, text);
--   --
--   -- 3. 列を落とす（★データ消失。フリガナ入力済みなら退避してから）
--   -- ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS legal_name_kana;
--   --
--   -- 4. NOTIFY pgrst, 'reload schema';
--   --
--   -- ※ 旧 complete_onboarding は本 migration で変更していないため復旧不要
--   --    （COMMENT のみ。戻す場合は COMMENT ON FUNCTION ... IS NULL;）。
--
-- ============================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。read-only / 無汚染）
-- ============================================================
--   -- 0. 列が存在する
--   -- SELECT column_name, is_nullable, data_type FROM information_schema.columns
--   --   WHERE table_schema='public' AND table_name='tenant_members' AND column_name='legal_name_kana';
--   --   -- 期待: legal_name_kana / YES / text
--   --
--   -- 1. 新列は authenticated / anon に SELECT も UPDATE も無い
--   -- SELECT has_column_privilege('authenticated','public.tenant_members','legal_name_kana','SELECT') AS a_sel,
--   --        has_column_privilege('anon','public.tenant_members','legal_name_kana','SELECT')          AS n_sel,
--   --        has_column_privilege('authenticated','public.tenant_members','legal_name_kana','UPDATE') AS a_upd,
--   --        has_column_privilege('anon','public.tenant_members','legal_name_kana','UPDATE')          AS n_upd;
--   --   -- 期待: 全て false
--   --
--   -- 2. VIEW 列数 17・末尾が legal_name_kana
--   -- SELECT count(*) FROM information_schema.columns
--   --   WHERE table_schema='public' AND table_name='tenant_members_visible'; -- 期待: 17
--   -- SELECT column_name FROM information_schema.columns
--   --   WHERE table_schema='public' AND table_name='tenant_members_visible'
--   --   ORDER BY ordinal_position DESC LIMIT 1; -- 期待: legal_name_kana
--   -- SELECT reloptions FROM pg_class WHERE oid='public.tenant_members_visible'::regclass;
--   --   -- 期待: {security_invoker=false}
--   -- SELECT has_table_privilege('authenticated','public.tenant_members_visible','SELECT'); -- 期待: true
--   -- SELECT has_table_privilege('anon','public.tenant_members_visible','SELECT');          -- 期待: false
--   --
--   -- 3. 新 RPC の権限
--   -- SELECT has_function_privilege('anon','public.complete_onboarding_v2(uuid,text,text,text)','EXECUTE')          AS anon_exec,
--   --        has_function_privilege('authenticated','public.complete_onboarding_v2(uuid,text,text,text)','EXECUTE') AS auth_exec;
--   --   -- 期待: anon_exec=false / auth_exec=true
--   -- SELECT prosecdef, proconfig FROM pg_proc
--   --   WHERE oid='public.complete_onboarding_v2(uuid,text,text,text)'::regprocedure;
--   --   -- 期待: prosecdef=true / proconfig={search_path=public, pg_temp}
--   --
--   -- 4. RLS policy は適用前後で不変（本 migration は policy 変更ゼロ）
--   -- SELECT policyname, cmd FROM pg_policies
--   --   WHERE schemaname='public' AND tablename='tenant_members' ORDER BY policyname;
--   --   -- 期待: 適用前スナップショットと完全一致（行数・内容とも差分ゼロ）
--   --
--   -- 5. 既存行のフリガナは全件 NULL（バックフィルなし）
--   -- SELECT count(*) FROM public.tenant_members WHERE legal_name_kana IS NOT NULL; -- 期待: 0
-- ============================================================
