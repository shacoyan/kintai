-- =====================================================================
-- 050_backfill_tenant_invite_codes.sql
-- 既存 tenants.invite_code (+ invite_code_stores) を新 v3 構造に backfill
--   - tenants.invite_code IS NOT NULL の行 → tenant_invite_codes 1 件
--   - 旧 invite_code_stores → tenant_invite_code_stores (store_id 順で sort_order 採番)
-- NOT EXISTS ガードで冪等 (再実行で重複 INSERT されない)
-- 設計書: .company/engineering/docs/2026-05-12-kintai-invite-url-per-store-techdesign.md §9.1
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- tenant_invite_codes backfill
-- ---------------------------------------------------------------------
INSERT INTO public.tenant_invite_codes (
  id, tenant_id, code, expires_at, max_uses, used_count, created_by, created_at, label
)
SELECT
  gen_random_uuid(),
  t.id,
  t.invite_code,
  t.invite_code_expires_at,
  t.invite_code_max_uses,
  COALESCE(t.invite_code_used_count, 0),
  t.owner_id,
  -- 作成日時を保持できないので、tenant 作成時刻にフォールバック
  COALESCE(t.created_at, now()),
  '[migrated from v2]'
  FROM public.tenants t
 WHERE t.invite_code IS NOT NULL
   AND t.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tenant_invite_codes ic
      WHERE ic.tenant_id = t.id
        AND ic.code = t.invite_code
        AND ic.revoked_at IS NULL
   );

-- ---------------------------------------------------------------------
-- tenant_invite_code_stores backfill (旧 invite_code_stores から転記)
-- ---------------------------------------------------------------------
-- 旧 (tenant_id, store_id) には sort 情報なし → store_id 文字列順で再現
INSERT INTO public.tenant_invite_code_stores (invite_code_id, store_id, sort_order)
SELECT
  ic.id,
  ics.store_id,
  row_number() OVER (PARTITION BY ic.id ORDER BY ics.store_id) - 1
  FROM public.invite_code_stores ics
  JOIN public.tenants t ON t.id = ics.tenant_id
  JOIN public.tenant_invite_codes ic
    ON ic.tenant_id = t.id
   AND ic.code = t.invite_code
   AND ic.revoked_at IS NULL
 WHERE t.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tenant_invite_code_stores tics
      WHERE tics.invite_code_id = ic.id
        AND tics.store_id = ics.store_id
   );

COMMIT;
