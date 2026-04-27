-- 027_correction_leave_store_id.sql
-- 目的: correction_requests / leave_requests に store_id を追加 (nullable)
-- 既存の RLS は tenant_id ベースを維持。store_id は表示用補足。
-- ロールバック: ALTER TABLE ... DROP COLUMN store_id;

BEGIN;

-- correction_requests
ALTER TABLE public.correction_requests
  ADD COLUMN IF NOT EXISTS store_id UUID NULL REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_correction_requests_store_id
  ON public.correction_requests(store_id);

-- leave_requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS store_id UUID NULL REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_requests_store_id
  ON public.leave_requests(store_id);

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_correction_requests_store_id;
-- DROP INDEX IF EXISTS public.idx_leave_requests_store_id;
-- ALTER TABLE public.correction_requests DROP COLUMN IF EXISTS store_id;
-- ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS store_id;
-- COMMIT;
