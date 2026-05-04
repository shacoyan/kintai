-- 035_shift_preferences_status_and_unavailable_auto_approve.sql
-- 目的:
--   1. shift_preferences.status カラムを正規化（types は定義済だが migration に未収録）
--   2. unavailable は提出時 status='approved' とする DB 側 trigger（UI 二重ガード）
--   3. 既存 unavailable pending レコードを approved に正規化
--   4. notifications.type に 'preference_unavailable_submitted' 追加
--   5. shift_preferences AFTER INSERT trigger で管理者へ通知 fan-out

BEGIN;

-- (1) status カラム
ALTER TABLE shift_preferences
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_shift_preferences_status
  ON shift_preferences(tenant_id, status);

-- (2) (3) 既存 unavailable を approved に矯正
UPDATE shift_preferences
   SET status = 'approved'
 WHERE preference_type = 'unavailable'
   AND status <> 'approved';

-- (4) notifications.type CHECK 拡張
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'shift_approved','shift_rejected',
    'preference_approved','preference_rejected','preference_reverted',
    'preference_unavailable_submitted',
    'correction_approved','correction_rejected',
    'leave_approved','leave_rejected',
    'generic'
  ));

-- (5) BEFORE INSERT trigger: unavailable は status='approved' 強制
CREATE OR REPLACE FUNCTION enforce_unavailable_auto_approve()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.preference_type = 'unavailable' THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_preferences_auto_approve ON shift_preferences;
CREATE TRIGGER trg_shift_preferences_auto_approve
  BEFORE INSERT OR UPDATE ON shift_preferences
  FOR EACH ROW EXECUTE FUNCTION enforce_unavailable_auto_approve();

-- (6) AFTER INSERT trigger: 管理者通知 fan-out (security definer)
CREATE OR REPLACE FUNCTION notify_admins_of_unavailable_preference()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_name TEXT;
  admin_id UUID;
BEGIN
  IF NEW.preference_type <> 'unavailable' THEN
    RETURN NEW;
  END IF;

  -- 提出者表示名（display_name 不在時は email or 'メンバー' フォールバック）
  SELECT COALESCE(NULLIF(tm.display_name, ''), 'メンバー')
    INTO member_name
    FROM tenant_members tm
   WHERE tm.tenant_id = NEW.tenant_id
     AND tm.user_id = NEW.user_id
   LIMIT 1;

  FOR admin_id IN
    SELECT user_id FROM tenant_members
     WHERE tenant_id = NEW.tenant_id
       AND role IN ('owner','manager')
  LOOP
    INSERT INTO notifications (tenant_id, user_id, type, title, body, link)
    VALUES (
      NEW.tenant_id,
      admin_id,
      'preference_unavailable_submitted',
      '出勤不可の希望が提出されました',
      member_name || ' が ' || NEW.date || ' を出勤不可で登録しました',
      '/shift?tab=preferences&date=' || NEW.date
    );
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_preferences_notify_admins ON shift_preferences;
CREATE TRIGGER trg_shift_preferences_notify_admins
  AFTER INSERT ON shift_preferences
  FOR EACH ROW EXECUTE FUNCTION notify_admins_of_unavailable_preference();

COMMIT;

-- [ROLLBACK]
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_shift_preferences_notify_admins ON shift_preferences;
-- DROP FUNCTION IF EXISTS notify_admins_of_unavailable_preference();
-- DROP TRIGGER IF EXISTS trg_shift_preferences_auto_approve ON shift_preferences;
-- DROP FUNCTION IF EXISTS enforce_unavailable_auto_approve();
-- ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (...旧8値...));
-- DROP INDEX IF EXISTS idx_shift_preferences_status;
-- ALTER TABLE shift_preferences DROP COLUMN IF EXISTS status;
-- COMMIT;
