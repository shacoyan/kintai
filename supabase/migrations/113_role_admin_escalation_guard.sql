-- =====================================================================
-- 113_role_admin_escalation_guard.sql — manager による admin 昇格を封鎖
-- 設計正本: .company/engineering/docs/2026-07-03-kintai-emergency-money-authz-batch.md
--           （§FG5 — 認可(昇格)・Tier L 緊急バッチ）
-- 前提: 099（tenant_members_update_non_owner）/082（role UPDATE GRANT）/
--       107（role CHECK {owner,admin,manager,staff} 拡張）本番適用済。
-- =====================================================================
-- ★★★ 目的・脆弱点 ★★★
--   現状 tenant_members_update_non_owner の WITH CHECK =
--     (role <> 'owner') AND is_tenant_managerial(tenant_id)
--   は owner 昇格は禁止するが admin 昇格は素通し。
--   攻撃: manager が UPDATE tenant_members SET role='admin' →
--   NEW.role='admin' <> 'owner' で WITH CHECK 通過 → 自己/共犯を admin 昇格。
--   107 で is_tenant_managerial は admin を含むため昇格後は managerial。
--   UI 実態: can('toggleMemberRole')=owner 専用・トグルは manager↔staff のみ。
--   admin 設定 UI 導線は皆無（admin 任命は P3-6 owner 専用 RPC 予定）→
--   admin 昇格を封じても正規導線を一切壊さない。
-- ★★★ 実装方針（二層防御・100 と同思想）★★★
--   層1(policy WITH CHECK): admin 昇格を owner のみ許可する述語を追加
--                          （DROP+CREATE・USING 不変）。
--   層2(BEFORE UPDATE トリガ): admin への遷移(OLD<>admin AND NEW=admin)を
--                          owner 以外は拒否（遷移を厳密に捕捉・防御多層化）。
--   トリガは SECURITY DEFINER 不要（内部の is_tenant_owner が DEFINER helper・
--   auth.uid() は呼出元解決）＝4行テンプレ対象外。
-- ★★★ 4 操作 before/after（tenant_members・FG5 範囲）★★★
--   UPDATE: (role<>owner) AND managerial
--         → ＋(role<>admin OR owner)・遷移トリガ    ＝ admin 昇格封鎖
--   INSERT: self・role='owner' 限定(082)             ＝ 不変（admin 直 INSERT 不可）
--   SELECT: co-members(get_my_tenant_ids)           ＝ 不変
--   DELETE: self・role<>owner                        ＝ 不変
--   ※ staff↔manager の direct UPDATE は本バッチ据え置き（P3-6 スコープ）。
--   ※ 層1 副作用（既存 admin 行の他列を manager が更新すると NEW.role='admin' で
--      WITH CHECK 落ち）＝ admin=0 の現在は無影響・将来も意図どおり（manager は
--      admin メンバーを編集不可＝admin>manager 階層に整合）。
--   ※ owner 昇格(role='owner')は既存 role<>'owner' で従来どおり全面禁止
--      （transferOwnership RPC 経由のみ）。
--   ※ 既存 tenant_members トリガは 0 件（grep 実測）＝トリガ名衝突なし。
-- =====================================================================

BEGIN;

-- 層1: policy 差し替え（USING 不変・WITH CHECK に admin 昇格 owner 限定を追加）
DROP POLICY IF EXISTS "tenant_members_update_non_owner" ON public.tenant_members;
CREATE POLICY "tenant_members_update_non_owner" ON public.tenant_members
  FOR UPDATE TO authenticated
  USING ((role <> 'owner') AND is_tenant_managerial(tenant_id))
  WITH CHECK ((role <> 'owner') AND is_tenant_managerial(tenant_id)
              AND (role <> 'admin' OR is_tenant_owner(tenant_id)));

-- 層2: admin 遷移トリガ（SECURITY DEFINER 不要＝通常トリガ）
CREATE OR REPLACE FUNCTION public.tenant_members_block_admin_escalation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin'
     AND NOT public.is_tenant_owner(NEW.tenant_id) THEN
    RAISE EXCEPTION '会社管理者(admin)への昇格はオーナーのみ実行できます'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tenant_members_block_admin_escalation ON public.tenant_members;
CREATE TRIGGER trg_tenant_members_block_admin_escalation
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.tenant_members_block_admin_escalation();

COMMIT;
