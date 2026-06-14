-- 080_store_members_tenant_consistency_trigger.sql
-- SEC-3: store_members 書込時テナント整合トリガ（多層防御の最終ピース）
--
-- 目的: store_members 行の member 所属テナントと store 所属テナントの不一致(越境)を
--       INSERT / UPDATE(store_id,member_id) 時に DB レベルで拒否する。
-- 背景: SEC-2(079)で売上読み取り側の越境は封鎖済。SEC-3 は書込側の最終ガード。
--       store_members は anon/authenticated に直 INSERT/UPDATE GRANT があり(RLSのみ防御)、
--       フロント useStore.addStoreMember が RPC 非経由で直 insert する → DB 不変条件で塞ぐ。
-- 設計書: .company/engineering/docs/2026-06-10-kintai-sec3-store-members-trigger.md
-- 冪等: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS → CREATE TRIGGER。
-- 既存データ: 2026-06-10 実査で全 40 行 same-tenant・違反0(設計書 §2 R4)。本 migration はデータ非変更。

-- ───────────────────────────────────────────────────────────
-- 1) トリガ関数
--    SECURITY DEFINER + search_path='' で RLS を越え両テーブルの真テナントを確定取得し比較。
--    INVOKER だと RLS(自テナントのみ可視)で他テナント行が NULL 化し可視性チェックに化けるため不可
--    (設計書 §5)。
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_store_member_tenant_consistency()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_member_tenant uuid;
  v_store_tenant  uuid;
BEGIN
  -- member の真の所属テナント(RLS 非依存)
  SELECT tm.tenant_id INTO v_member_tenant
    FROM public.tenant_members tm
   WHERE tm.id = NEW.member_id;

  -- store の真の所属テナント(RLS 非依存)
  SELECT s.tenant_id INTO v_store_tenant
    FROM public.stores s
   WHERE s.id = NEW.store_id;

  -- fail-closed: FK(NOT NULL + ON DELETE CASCADE)により通常 NULL は起きないが防御的に拒否
  IF v_member_tenant IS NULL THEN
    RAISE EXCEPTION
      'store_members 整合違反: member_id=% が tenant_members に存在しません(所属テナント不明のため店舗紐付け不可)',
      NEW.member_id
      USING ERRCODE = '23514';
  END IF;

  IF v_store_tenant IS NULL THEN
    RAISE EXCEPTION
      'store_members 整合違反: store_id=% が stores に存在しません(所属テナント不明のため店舗紐付け不可)',
      NEW.store_id
      USING ERRCODE = '23514';
  END IF;

  -- 本命: テナント越境の拒否
  IF v_member_tenant <> v_store_tenant THEN
    RAISE EXCEPTION
      'store_members 整合違反(テナント越境): member_id=% は tenant=% 所属ですが、store_id=% は tenant=% 所属です。同一テナント内のメンバーと店舗のみ紐付けできます。',
      NEW.member_id, v_member_tenant, NEW.store_id, v_store_tenant
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_store_member_tenant_consistency() IS
  'SEC-3(080): store_members INSERT/UPDATE 時に member の所属テナント=store の所属テナントを強制する BEFORE トリガ関数。RLS 越えで真テナントを確定取得するため SECURITY DEFINER + search_path=''''。多層防御の最終ピース。設計書 2026-06-10-kintai-sec3-store-members-trigger.md。';

-- トリガ専用に閉じる(直接 EXECUTE API ではないため PUBLIC の EXECUTE は不要・任意の堅牢化)
REVOKE EXECUTE ON FUNCTION public.enforce_store_member_tenant_consistency() FROM PUBLIC;

-- ───────────────────────────────────────────────────────────
-- 2) トリガ
--    UPDATE は store_id/member_id 変更時のみ発火(is_primary/is_manager のみの更新は素通し)。
--    INSERT は全行対象。冪等のため DROP IF EXISTS 後に CREATE。
-- ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_store_members_tenant_consistency ON public.store_members;

CREATE TRIGGER trg_store_members_tenant_consistency
  BEFORE INSERT OR UPDATE OF store_id, member_id
  ON public.store_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_store_member_tenant_consistency();
