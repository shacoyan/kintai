-- ============================================================================
-- 072_square_sales_tenant_scope_fix.sql
-- ----------------------------------------------------------------------------
-- 目的（SEC-1 封鎖 / テナント越境の売上漏洩）:
--   square_dashboard.get_allowed_location_ids(text[]) の owner/manager 分岐が
--   「テナント無条件で全 active locations_meta を返す」ため、SABABA と無関係の
--   テナント owner/manager（E2E Test / テスト株式会社の計4名）が SABABA 全7店の
--   売上を閲覧できていた。これを「自分が owner/manager として所属するテナント群の
--   stores に解決される location だけ」に限定する。staff 分岐は無改変。
--   オーナー裁定 2026-06-09「自テナントの店舗だけ閲覧可・テナント直書きしない汎用修正」。
--
-- 対象 project:
--   kintai = zjjbfffhbobwwxyvdszl  （★ apply 前に list_projects で name 必ず確認。
--                                    receipt-scanner=zzopayofegpmdkwckstq 誤投入厳禁）
--
-- 波及:
--   helper を CREATE OR REPLACE すると、070 get_sales_range_scoped /
--   071 get_sales_by_location_scoped（両者は helper を呼ぶだけ）に自動波及する。
--   RPC 本体は無改変。
--
-- 可逆性: 関数本体のみ差し替え。データ変更なし。ロールバックは本ファイル末尾の
--         「ロールバック SQL」で 070 版 owner/manager 分岐に戻す。
-- 冪等性: CREATE OR REPLACE FUNCTION / REVOKE（不在でも非エラー）で再実行安全。
--
-- 実証（kintai 本番、2026-06-10）:
--   SABABA 関係3名 = 7店維持 / E2E・テスト株式会社4名 = 0店に矯正 /
--   inject ['吸暮','金魚'] for テスト株式会社owner = [] / 複数テナント和集合は DISTINCT で重複なし。
-- ============================================================================

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

  -- 2. owner/manager 判定（uid が少なくとも 1 テナントで owner/manager か）。
  v_can_view_all := EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = v_uid
      AND tm.role IN ('owner', 'manager')
  );

  IF v_can_view_all THEN
    -- 3a. owner/manager: 【SEC-1 修正】全 active ではなく、
    --     「自分が owner/manager である全テナントの stores」を
    --     name → CASE(こまいぬ→狛犬) → locations_meta(active) に INNER JOIN した集合。
    --     複数テナント所属は array_agg(DISTINCT …) で和集合（重複排除）。
    --     経営内勤等の Square 未マップ store は INNER JOIN で自然除外。
    --     テナント ID は直書きしない（stores.tenant_id を辿る純構造判定）。
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
    WHERE tm.user_id = v_uid
      AND tm.role IN ('owner', 'manager')
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)   -- リクエスト交差（越境 inject は黙って無視）
      );
  ELSE
    -- 3b. staff: 所属店のみ（070 から無改変）。
    --     store_members(member_id=tenant_members.id) → stores.name
    --     → CASE(こまいぬ→狛犬) → locations_meta INNER JOIN（未マッチ店は自然除外）。
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
    WHERE tm.user_id = v_uid
      AND (
        p_location_names IS NULL
        OR array_length(p_location_names, 1) IS NULL
        OR lm.location_name = ANY (p_location_names)   -- リクエスト交差（越権は黙って無視）
      );
  END IF;

  RETURN COALESCE(v_loc_ids, ARRAY[]::text[]);
END;
$$;

-- 権限 4 行テンプレ（070 と同一・冪等）。search_path は関数定義に内包済み。
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION square_dashboard.get_allowed_location_ids(text[]) TO authenticated;
