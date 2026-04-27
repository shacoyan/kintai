-- 028_notifications.sql
-- 目的: in-app 通知基盤 (Supabase Realtime broadcast + 永続化テーブル)
-- スコープ: tenant_id ベース RLS / user_id 受信者単位 / 既読は read_at TIMESTAMPTZ
-- 種別 (type): 'shift_approved' | 'shift_rejected' | 'preference_approved' | 'preference_rejected' | 'preference_reverted'
--             | 'correction_approved' | 'correction_rejected' | 'leave_approved' | 'leave_rejected' | 'generic'

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN (
      'shift_approved','shift_rejected',
      'preference_approved','preference_rejected','preference_reverted',
      'correction_approved','correction_rejected',
      'leave_approved','leave_rejected',
      'generic'
    )),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON public.notifications(tenant_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 受信者本人のみ SELECT
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- 送信側: 同一 tenant に所属する owner / manager が INSERT 可
-- 受信者 user_id が同 tenant の member であることを検証
CREATE POLICY "notifications_insert_owner_manager" ON public.notifications
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = notifications.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner','manager')
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = notifications.tenant_id
      AND tm.user_id = notifications.user_id
    )
  );

-- 受信者本人のみ UPDATE (read_at セット用)
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 受信者本人のみ DELETE (任意の通知削除)
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP TABLE IF EXISTS public.notifications;
-- COMMIT;
