-- Loop B: shift_preferences の UNIQUE 制約を (tenant_id, user_id, date, store_id) に組み替え
-- 旧 UNIQUE 制約名は migration 016 のインライン UNIQUE(tenant_id, user_id, date) に基づく PostgreSQL デフォルト名。
-- 想定: shift_preferences_tenant_id_user_id_date_key
-- 適用前確認:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'shift_preferences'::regclass AND contype = 'u';

BEGIN;

-- 1) 旧 UNIQUE 制約を破棄（存在しない場合は無視）
ALTER TABLE shift_preferences
  DROP CONSTRAINT IF EXISTS shift_preferences_tenant_id_user_id_date_key;

-- 2) NULL 値の事前削除（複合 UNIQUE で NULL 同士が重複扱いされない問題への対応）
--    Loop A 時点で shift_preferences.store_id IS NULL のレコードは未削除のため、ここで一括削除する。
--    本番データ投入前の段階のため、テスト/未割り当てデータのみと想定。
DELETE FROM shift_preferences WHERE store_id IS NULL;

-- 3) 新 UNIQUE 制約を追加（store_id を含む 4 列複合）
ALTER TABLE shift_preferences
  ADD CONSTRAINT shift_preferences_tenant_user_date_store_key
  UNIQUE (tenant_id, user_id, date, store_id);

COMMIT;

-- ロールバック手順（参考・実行しない）
--   BEGIN;
--   ALTER TABLE shift_preferences DROP CONSTRAINT shift_preferences_tenant_user_date_store_key;
--   ALTER TABLE shift_preferences ADD CONSTRAINT shift_preferences_tenant_id_user_id_date_key
--     UNIQUE (tenant_id, user_id, date);
--   COMMIT;
