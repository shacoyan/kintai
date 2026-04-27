-- 025_shift_presets_update_rls.sql
-- Loop 7 (Engineer B): shift_presets RLS を Loop A 以降の role 語彙 (owner/manager) に整合させる。
-- 014 では INSERT/UPDATE/DELETE で role IN ('owner','admin') を要求していたが、
-- 'admin' ロールは廃止され 'manager' に統一された。
-- 加えて編集 UI が無く UPDATE 経路が未検証だったので明示的にポリシーを再作成する。

DROP POLICY IF EXISTS "shift_presets_insert" ON public.shift_presets;
DROP POLICY IF EXISTS "shift_presets_update" ON public.shift_presets;
DROP POLICY IF EXISTS "shift_presets_delete" ON public.shift_presets;

CREATE POLICY shift_presets_insert ON public.shift_presets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY shift_presets_update ON public.shift_presets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY shift_presets_delete ON public.shift_presets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
