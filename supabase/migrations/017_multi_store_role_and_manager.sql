-- ============================================================================
-- 017: 複数店舗対応 Loop A
--   - tenant_members.role: 'admin' を 'manager' にリネーム + CHECK 制約変更
--   - store_members.is_manager 追加
--   - store_members(member_id) WHERE is_primary 部分 UNIQUE
--   - shift_preferences.store_id 追加（Loop B 用先行）
--   - attendance_records / shifts の store_id IS NULL レコード削除（テストデータ）
--   - RLS ポリシーで 'admin' を参照している箇所を 'manager' に置換
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) 既存 RLS ポリシー drop（'admin' 文字列を含むもの・実 DB の名前で正確に）
-- ---------------------------------------------------------------------------

-- attendance_records（002 / 007 / 010 由来）
DROP POLICY IF EXISTS "Admin view tenant records"   ON attendance_records;
DROP POLICY IF EXISTS "Admin update tenant records" ON attendance_records;
DROP POLICY IF EXISTS "Admin delete tenant records" ON attendance_records;
DROP POLICY IF EXISTS "Admin update attendance"     ON attendance_records;

-- breaks（003 / 010 由来）
DROP POLICY IF EXISTS "Admin view tenant breaks"   ON breaks;
DROP POLICY IF EXISTS "Admin manage tenant breaks" ON breaks;

-- correction_requests（003 / 010 由来）
DROP POLICY IF EXISTS "Admin view tenant requests"   ON correction_requests;
DROP POLICY IF EXISTS "Admin update requests"        ON correction_requests;
DROP POLICY IF EXISTS "Admin delete requests"        ON correction_requests;

-- shifts（012 由来）
DROP POLICY IF EXISTS "shifts_update" ON shifts;

-- shift_presets（014 由来）
DROP POLICY IF EXISTS "shift_presets_insert" ON shift_presets;
DROP POLICY IF EXISTS "shift_presets_update" ON shift_presets;
DROP POLICY IF EXISTS "shift_presets_delete" ON shift_presets;

-- leave_requests（013 由来）
DROP POLICY IF EXISTS "leave_update" ON leave_requests;

-- shift_preferences（016 由来）
DROP POLICY IF EXISTS "Admins can view all shift_preferences" ON shift_preferences;

-- stores / store_members（015 由来）
DROP POLICY IF EXISTS "Admins can manage stores"        ON stores;
DROP POLICY IF EXISTS "Admins can manage store_members" ON store_members;

-- ---------------------------------------------------------------------------
-- 2) tenant_members.role の CHECK 制約変更（'admin' → 'manager'）
-- ---------------------------------------------------------------------------

ALTER TABLE tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;

-- 3) 既存値変換: 'admin' → 'manager'
UPDATE tenant_members SET role = 'manager' WHERE role = 'admin';

-- 4) 新 CHECK 制約
ALTER TABLE tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner', 'manager', 'staff'));

-- ---------------------------------------------------------------------------
-- 5) store_members.is_manager 追加
-- ---------------------------------------------------------------------------

ALTER TABLE store_members
  ADD COLUMN IF NOT EXISTS is_manager BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 6) store_members(member_id) 部分 UNIQUE: 各メンバーの primary 店舗は最大 1 つ
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uniq_store_members_primary_per_member
  ON store_members(member_id)
  WHERE is_primary = true;

-- ---------------------------------------------------------------------------
-- 7) shift_preferences.store_id 追加（Loop B 先行）
-- ---------------------------------------------------------------------------

ALTER TABLE shift_preferences
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_preferences_store
  ON shift_preferences(store_id);

-- ---------------------------------------------------------------------------
-- 8) テストデータクリーンアップ（store_id 未設定の既存打刻 / シフト）
-- ---------------------------------------------------------------------------

DELETE FROM attendance_records WHERE store_id IS NULL;
DELETE FROM shifts            WHERE store_id IS NULL;
-- shift_presets.store_id は Loop A 範囲外（Loop B でピッカー導入）。NULL 許容のまま据え置き。

-- ---------------------------------------------------------------------------
-- 9) RLS ポリシー再作成（'manager' 版・元の構造を踏襲）
-- ---------------------------------------------------------------------------

-- 9-a) attendance_records（002 / 007 / 010 由来。tenant_id 直接参照）
CREATE POLICY "Managers can view tenant records" ON attendance_records
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete tenant records" ON attendance_records
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update attendance" ON attendance_records
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- 9-b) breaks（003 / 010 由来。tenant_id カラム無し → attendance_record_id 経由）
CREATE POLICY "Managers can view tenant breaks" ON breaks
  FOR SELECT USING (
    attendance_record_id IN (
      SELECT id FROM attendance_records WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
      )
    )
  );

CREATE POLICY "Managers can manage tenant breaks" ON breaks
  FOR ALL USING (
    attendance_record_id IN (
      SELECT id FROM attendance_records WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
      )
    )
  );

-- 9-c) correction_requests（003 / 010 由来。tenant_id 直接参照）
CREATE POLICY "Managers can view tenant requests" ON correction_requests
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can update requests" ON correction_requests
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers can delete requests" ON correction_requests
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- 9-d) shifts（012 由来。元構造を維持しつつ admin → manager）
CREATE POLICY "shifts_update" ON shifts FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = shifts.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
    )
  );

-- 9-e) shift_presets（014 由来。is_tenant_owner OR EXISTS の構造を維持）
CREATE POLICY "shift_presets_insert" ON shift_presets FOR INSERT
  WITH CHECK (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "shift_presets_update" ON shift_presets FOR UPDATE
  USING (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "shift_presets_delete" ON shift_presets FOR DELETE
  USING (
    is_tenant_owner(tenant_id)
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_id = shift_presets.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- 9-f) leave_requests（013 由来。tenant_id IN (get_my_tenant_ids()) AND (user一致 OR owner OR manager) を維持）
CREATE POLICY "leave_update" ON leave_requests FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR is_tenant_owner(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_members
        WHERE tenant_id = leave_requests.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
    )
  );

-- 9-g) shift_preferences（016 由来。tenant_id 直接参照）
CREATE POLICY "Managers can view all shift_preferences" ON shift_preferences
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- 9-h) stores（015 由来。tenant_id 直接参照）
CREATE POLICY "Managers can manage stores" ON stores
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- 9-i) store_members（015 由来。tenant_id カラム無し → stores JOIN）
CREATE POLICY "Managers can manage store_members" ON store_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN tenant_members tm ON tm.tenant_id = s.tenant_id
      WHERE s.id = store_members.store_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
    )
  );

COMMIT;

-- ============================================================================
-- ロールバック手順（参考・実行しない）
--   1) ALTER TABLE tenant_members DROP CONSTRAINT tenant_members_role_check;
--   2) UPDATE tenant_members SET role='admin' WHERE role='manager';
--   3) ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_role_check
--        CHECK (role IN ('owner','admin','staff'));
--   4) ALTER TABLE store_members DROP COLUMN is_manager;
--   5) DROP INDEX uniq_store_members_primary_per_member;
--   6) DROP INDEX idx_shift_preferences_store;
--   7) ALTER TABLE shift_preferences DROP COLUMN store_id;
--   8) 各 RLS ポリシーを 'admin' 版で再作成（元 migration 003/007/010/012/013/014/015/016 を参照）
-- ============================================================================
