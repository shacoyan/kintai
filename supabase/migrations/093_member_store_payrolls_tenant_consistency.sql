-- Migration 093: member_store_payrolls のテナント整合トリガ（P2/P3 B2）
--
-- 背景（実測 2026-06-15・本番 zjjbfffhbobwwxyvdszl の information_schema.columns）:
--   member_store_payrolls(店舗別の時給/月給 override) は (tenant_id, user_id, store_id, pay_type,
--   hourly_rate, monthly_salary, night_shift_rate_multiplier, …) を持つが、store_members(080)と違い
--   「行の tenant_id」と「store_id の真の所属テナント」「user_id のそのテナント所属」を強制する
--   DB 不変条件が無い（item: member-store-payroll-no-tenant-consistency）。
--   フロントが直 upsert する経路（RPC 非経由）では、悪意ある/バグった tenant_id 詐称や、
--   他テナントの store_id を紐付けた越境 payroll override を挿入し得る = 給与計算の越境汚染。
--
-- 設計方針:
--   080 enforce_store_member_tenant_consistency と同型の BEFORE INSERT/UPDATE トリガを追加。
--   新関数 enforce_member_store_payroll_tenant_consistency:
--     - SECURITY DEFINER + search_path=''（RLS を越え両テーブルの真テナントを確定取得。
--       INVOKER だと RLS で他テナント行が NULL 化し可視性チェックに化けるため不可。080 §5 と同論拠）。
--     - store_id の真の所属テナント = NEW.tenant_id を強制（本命: 店舗越境の拒否）。
--     - 防御的に user_id が NEW.tenant_id に tenant_members として所属することも検証
--       （越境 user の payroll override を拒否。msp に member_id は無く user_id 列のため
--        tenant_members(tenant_id,user_id) で判定）。
--     - FK で通常 NULL は起きないが fail-closed で NULL も 23514 拒否。
--   トリガは store_id / tenant_id / user_id 変更時のみ発火（金額のみ更新は素通し）。
--   RAISE EXCEPTION で BEFORE 段階拒否 → トランザクション全体ロールバック。
--   関数は anon/PUBLIC を REVOKE、authenticated を GRANT（MEMORY 規律。トリガ専用でも明示）。
--
-- 横串確認:
--   基底表 member_store_payrolls の RLS policy（SELECT/INSERT/UPDATE/DELETE）には触れない。
--   既存データ: 全行が同一テナント整合である前提（投入後に検証 SQL で違反0を確認すること）。
--   正規 upsert（同一テナント・自店舗・自テナント所属 user）は素通しする。
--
-- Rollback / 検証 SQL: 本ファイル末尾コメント参照。

BEGIN;

-- ───────────────────────────────────────────────────────────
-- 1) トリガ関数
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_member_store_payroll_tenant_consistency()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_store_tenant uuid;
  v_user_in_tenant boolean;
BEGIN
  -- store の真の所属テナント（RLS 非依存）
  SELECT s.tenant_id INTO v_store_tenant
    FROM public.stores s
   WHERE s.id = NEW.store_id;

  -- fail-closed: FK 上 NULL は通常起きないが防御的に拒否
  IF v_store_tenant IS NULL THEN
    RAISE EXCEPTION
      'member_store_payrolls 整合違反: store_id=% が stores に存在しません（所属テナント不明のため給与設定不可）。',
      NEW.store_id
      USING ERRCODE = '23514';
  END IF;

  -- 本命: 行の tenant_id と store の所属テナントの一致を強制（店舗越境の拒否）
  IF NEW.tenant_id <> v_store_tenant THEN
    RAISE EXCEPTION
      'member_store_payrolls 整合違反（テナント越境）: 行の tenant_id=% ですが store_id=% は tenant=% 所属です。同一テナントの店舗にのみ給与設定できます。',
      NEW.tenant_id, NEW.store_id, v_store_tenant
      USING ERRCODE = '23514';
  END IF;

  -- 防御: user_id が当該テナントの tenant_members として所属しているか（越境 user の拒否）
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.user_id = NEW.user_id
       AND tm.tenant_id = NEW.tenant_id
  ) INTO v_user_in_tenant;

  IF NOT v_user_in_tenant THEN
    RAISE EXCEPTION
      'member_store_payrolls 整合違反: user_id=% は tenant=% に所属していません（テナント外メンバーの給与設定は不可）。',
      NEW.user_id, NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_member_store_payroll_tenant_consistency() IS
  'P2/P3 B2(093): member_store_payrolls INSERT/UPDATE 時に 行 tenant_id = store の所属テナント、'
  'かつ user が当該テナント所属であることを強制する BEFORE トリガ関数。RLS 越えで真テナントを '
  '確定取得するため SECURITY DEFINER + search_path=''''。080 store_members トリガと同型。';

-- トリガ専用に閉じる（MEMORY 規律: anon/PUBLIC 剥奪 + authenticated 明示）
REVOKE EXECUTE ON FUNCTION public.enforce_member_store_payroll_tenant_consistency() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_member_store_payroll_tenant_consistency() FROM anon;
GRANT  EXECUTE ON FUNCTION public.enforce_member_store_payroll_tenant_consistency() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 2) トリガ（store_id / tenant_id / user_id 変更時に発火。金額のみ更新は素通し）
--    冪等のため DROP IF EXISTS 後に CREATE。
-- ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_member_store_payrolls_tenant_consistency ON public.member_store_payrolls;

CREATE TRIGGER trg_member_store_payrolls_tenant_consistency
  BEFORE INSERT OR UPDATE OF store_id, tenant_id, user_id
  ON public.member_store_payrolls
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_member_store_payroll_tenant_consistency();

COMMIT;

-- =========================================================================
-- ROLLBACK SQL（093 適用前=トリガと関数を除去。手動）
-- =========================================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_member_store_payrolls_tenant_consistency ON public.member_store_payrolls;
--   DROP FUNCTION IF EXISTS public.enforce_member_store_payroll_tenant_consistency();
-- COMMIT;

-- =========================================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件）
-- =========================================================================
-- -- 0. 既存データに違反が無いこと（あれば先に是正してから本番 apply）
-- SELECT msp.id, msp.tenant_id AS row_tenant, s.tenant_id AS store_tenant, msp.user_id
-- FROM public.member_store_payrolls msp
-- JOIN public.stores s ON s.id = msp.store_id
-- WHERE msp.tenant_id <> s.tenant_id
--    OR NOT EXISTS (SELECT 1 FROM public.tenant_members tm
--                   WHERE tm.user_id = msp.user_id AND tm.tenant_id = msp.tenant_id);
-- -- → 0 行なら既存整合 OK。
--
-- -- 1.(攻撃) 他テナントの store_id を紐付けた越境 INSERT → 23514 で拒否されれば PASS（無汚染）
-- -- BEGIN;
-- --   INSERT INTO public.member_store_payrolls (tenant_id, user_id, store_id, pay_type, hourly_rate)
-- --   VALUES ('<TENANT_A>','<USER_IN_A>','<STORE_OF_TENANT_B>','hourly',1500);
-- --   -- → ERROR 23514（テナント越境）なら PASS。
-- -- ROLLBACK;
--
-- -- 2.(正常) 同一テナント・自店舗・自テナント所属 user の upsert → 成功（無汚染）
-- -- BEGIN;
-- --   INSERT INTO public.member_store_payrolls (tenant_id, user_id, store_id, pay_type, hourly_rate)
-- --   VALUES ('<TENANT_A>','<USER_IN_A>','<STORE_OF_TENANT_A>','hourly',1500);
-- --   -- → 成功すれば PASS。
-- -- ROLLBACK;
