-- ============================================================================
-- 079_square_locations_meta_tenant_binding.sql
-- ----------------------------------------------------------------------------
-- 目的（SEC-2 / 同名 store による越境再開ベクタの構造封鎖）:
--   072(SEC-1) は owner/manager の可視を「自テナント stores の name→CASE→locations_meta」
--   に限定したが、locations_meta.location_name がテナント横断グローバル名のため、
--   他テナントが同名 store(例:'吸暮')を自テナントに作成すると SABABA 同名店売上への
--   越境が再開する。本番では既に吸暮テナントが store='吸暮' を保有し構造的に成立。
--   本来解として locations_meta にテナント帰属(tenant_id)を付与し、helper の
--   owner/manager・staff 両分岐の locations_meta JOIN を name 一致 ∧ tenant_id 一致の
--   AND 条件にする。tenant_id IS NULL の location は誰にもマッチしない(fail-closed)。
--   オーナー裁定 2026-06-09 系列「自テナントの店舗だけ閲覧可・テナント直書きしない汎用修正」
--   の構造的補完。
--
-- 対象 project:
--   kintai = zjjbfffhbobwwxyvdszl  (★ apply 前に list_projects で name 必ず確認。
--                                    receipt-scanner=zzopayofegpmdkwckstq 誤投入厳禁)
--
-- 波及:
--   helper を CREATE OR REPLACE すると 070/071/073/076/077 の各 RPC(helper を呼ぶだけ)に
--   シグネチャ不変のまま自動波及する。RPC 本体は無改変。
--
-- cron 非破壊性:
--   square-dashboard/api/cron/aggregate-daily-sales.js の locations_meta 自己同期 upsert は
--   payload に tenant_id を含まない(location_id/location_name/is_active のみ)。
--   onConflict=location_id の upsert は payload 列のみ UPDATE するため、seed 済 tenant_id は
--   cron で NULL 上書きされない。新規 location は tenant_id=NULL で INSERT され fail-closed。
--
-- 可逆性: 関数本体差し替え + 列追加 + seed UPDATE。ロールバックは設計書 §6 参照
--         （R1=helper を 072 版に戻す最小ロールバック / R2=列も DROP するフルロールバック。
--          順序厳守: R1→R2。helper が列を参照したまま DROP すると 42703 になる）。
-- 冪等性: ADD COLUMN IF NOT EXISTS / UPDATE ... WHERE tenant_id IS NULL /
--         CREATE OR REPLACE / REVOKE(不在でも非エラー) で再実行安全。
-- NOT NULL 禁止理由: cron 自己同期 upsert(§3)が tenant_id を渡さないため、新規 location は
--         NULL で INSERT される。NOT NULL にすると cron INSERT が失敗しデータ取込が止まる
--         事故になる。NULL は AND 条件で誰にもマッチせず fail-closed のため NULL 許容で安全。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) tenant_id 列追加（NULL 許容。cron INSERT を壊さないため NOT NULL 禁止）
-- ---------------------------------------------------------------------------
ALTER TABLE square_dashboard.locations_meta
  ADD COLUMN IF NOT EXISTS tenant_id uuid NULL
    REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN square_dashboard.locations_meta.tenant_id IS
  'この Square location が帰属するテナント(public.tenants.id)。NULL は未割当=どのユーザーにも非可視(fail-closed)。SEC-2(079)で追加。新店は手動付与が必要(設計書 2026-06-10-kintai-sec2-tenant-binding.md §7)。';

-- ---------------------------------------------------------------------------
-- (2) 既存 7 店を SABABA で seed（7 location_id 明示限定・冪等）
--     locations_meta は現状この 7 行のみ（実査: total=7=in_id7、not_in_id7=0）。
--     将来 non-SABABA location が NULL で混在しても巻き込まないよう id 限定で誤帰属を根絶。
-- ---------------------------------------------------------------------------
UPDATE square_dashboard.locations_meta
   SET tenant_id = '6650e979-1777-44f4-a01b-a1752a37f92c'  -- 株式会社SABABA
 WHERE location_id IN (
   'L6XTQNR959AQV',  -- Goodbye
   'LGTE7C72EFHJ4',  -- KITUNE
   'LJDG84FRFND94',  -- LR
   'LZTWCNJ8G5RZ8',  -- moumou
   'LKVHN7M31BND3',  -- 吸暮
   'L751GG8WDXBAV',  -- 狛犬
   'L82EWX2EEAZVZ'   -- 金魚
 )
   AND tenant_id IS NULL;  -- 冪等: 既割当行は再実行で上書きしない

-- ---------------------------------------------------------------------------
-- (3) helper 差し替え（両分岐に tenant_id 一致条件を追加。072 版との差分は owner/manager +1 / staff +2（うち 1 行は store_members クロステナント行への二重ガード）= 計 3 行）
--     シグネチャ/戻り型/SECURITY DEFINER/STABLE/search_path/権限は 072 と完全同一。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION square_dashboard.get_allowed_location_ids(
  p_location_names text[] DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid;
  v_can_view_all boolean;
  v_loc_ids      text[];
BEGIN
  -- 1. 認証ユーザー。未認証なら fail-closed（空配列）。
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 2. owner/manager 判定。
  v_can_view_all := EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = v_uid
      AND tm.role IN ('owner', 'manager')
  );

  IF v_can_view_all THEN
    -- 3a. owner/manager: 自テナント stores を name→CASE→locations_meta に INNER JOIN。
    --     【SEC-2】lm.tenant_id = tm.tenant_id を AND して同名 store 越境を構造封鎖。
    SELECT array_agg(DISTINCT lm.location_id)
    INTO v_loc_ids
    FROM public.tenant_members tm
    JOIN public.stores st
      ON st.tenant_id = tm.tenant_id
    JOIN square_dashboard.locations_meta lm
      ON lm.location_name = (
           CASE WHEN st.name = 'こまいぬ' THEN '狛犬' ELSE st.name END
         )
     AND lm.is_active = true
     AND lm.tenant_id = tm.tenant_id            -- ★SEC-2
    WHERE tm.user_id = v_uid
      AND tm.role IN ('owner', 'manager')
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)
      );
  ELSE
    -- 3b. staff: 所属店のみ。store_members→stores→locations_meta。
    --     【SEC-2】lm.tenant_id = st.tenant_id を AND（store の帰属テナントで照合）。
    SELECT array_agg(DISTINCT lm.location_id)
    INTO v_loc_ids
    FROM public.tenant_members tm
    JOIN public.store_members sm
      ON sm.member_id = tm.id
    JOIN public.stores st
      ON st.id = sm.store_id
    JOIN square_dashboard.locations_meta lm
      ON lm.location_name = (
           CASE WHEN st.name = 'こまいぬ' THEN '狛犬' ELSE st.name END
         )
     AND lm.is_active = true
     AND lm.tenant_id = st.tenant_id            -- ★SEC-2: location の帰属テナント一致
     AND st.tenant_id = tm.tenant_id            -- ★SEC-2 二重ガード: sm 経由クロステナント store_members を認可解決点で排除（store_members に整合制約が DB 上不在のため。現データは全 same_tenant で正当ユーザー無影響。上流の書込時強制は SEC-3 別チケット）
    WHERE tm.user_id = v_uid
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)
      );
  END IF;

  RETURN COALESCE(v_loc_ids, ARRAY[]::text[]);
END;
$$;

-- 権限 4 行テンプレ（070/072 と同一・冪等）。
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) TO authenticated;
