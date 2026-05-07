-- =============================================================================
-- 037_consolidated_catchup.sql
--
-- 【目的】
--   prod (Supabase project zjjbfffhbobwwxyvdszl) の schema_migrations は
--   2026-05-04 時点で 035 までしか登録されておらず、
--   ローカルに存在する 023〜034 + 036 の合計 12 本が連続未適用となっている。
--   035 のみが先行 push された結果、prod スキーマがコード前提 (role_id / legal_name 等)
--   から大きく乖離しているため、これら 12 本の差分を 1 ファイルに統合し、
--   単一トランザクションで原子的にキャッチアップする。
--
-- 【統合対象 (適用順)】
--   §1  023_leave_review_note_and_half        — leave_requests.review_note + half_paid → half_am/half_pm
--   §2  027_correction_leave_store_id          — correction_requests / leave_requests に store_id
--   §3  029_leave_type_extend                  — leave_type CHECK に法定休暇 5 種追加 (§1 後)
--   §4  024_payroll_finalization               — tenants.payroll_close_day + payroll_runs / payroll_run_items + RLS
--   §5  030_tenant_roles                       — tenant_roles テーブル + tenant_members.role_id + RLS (§12 の前提)
--   §6  026_deadline_guard_and_default         — tenants.default_deadline_day + shift_preferences RLS 締切ガード
--   §7  025_shift_presets_update_rls           — prod は既に強化版 policy → no-op (理由コメントのみ)
--   §8  031_tenant_soft_delete                 — tenants.deleted_at + get_my_tenant_ids 再定義 + soft_delete_tenant
--   §9  032_transfer_ownership                 — transfer_tenant_ownership RPC
--   §10 033_invite_code_limits                 — tenants.invite_code_* + increment_invite_code_use + join_tenant_with_invite
--   §11 034_tenant_member_self_delete          — tenant_members_delete_self_non_owner policy
--   §12 036_legal_name_and_onboarding          — tenant_members.legal_name + onboarded_at + 列 GRANT + tenant_members_visible + complete_onboarding + night_shift_enabled DEFAULT
--
-- 【なぜ単発 037 にするか】
--   1) 12 本を 12 回個別 apply する案 A は途中失敗時に中途半端なスキーマが残るリスクが高い
--      (CREATE POLICY が IF NOT EXISTS 非対応のため 42710 が連発しやすい)。
--   2) 1 トランザクションなら失敗時にすべてロールバックされ、prod は確実に「035 適用済」状態に戻る。
--   3) prod 実態 (旧 policy "Users manage own shift_preferences" が残存 / shift_presets policy が
--      ローカル 025 より強化済 等) に合わせた idempotent SQL に書き直せる。
--   4) Reviewer / dev branch 試走の対象が 1 ファイルに集約され、レビュー範囲が明確になる。
--
-- 【冪等性ポリシー】
--   - ALTER TABLE ADD COLUMN は IF NOT EXISTS
--   - CREATE TABLE / CREATE INDEX / CREATE POLICY は IF NOT EXISTS（POLICY は前置 DROP IF EXISTS）
--   - CREATE FUNCTION / CREATE VIEW は OR REPLACE
--   - CHECK 制約は DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT
--   - GRANT/REVOKE は冪等 (繰り返し OK)
--
-- 【ロールバック】
--   037 適用が COMMIT 直前にエラーで失敗した場合は自動 ROLLBACK。
--   COMMIT 後にバグが判明した場合は本ファイル末尾の [ROLLBACK BLOCK] を別 SQL として
--   手動実行する (詳細は復旧手順書 §4)。
--
-- 【schema_migrations 記録】
--   version: 20260504200000
--   name   : 037_consolidated_catchup
--   ローカル 023〜034, 036 は schema_migrations に個別登録されないため、
--   後続運用で `supabase migration repair --status applied 023..034 036` を実行する
--   別 issue を起票すること (本ファイル範囲外)。
-- =============================================================================

BEGIN;

-- =============================================================================
-- §1 (origin: 023) — leave_requests.review_note + half_paid → half_am/half_pm
-- =============================================================================
-- A. review_note カラム追加（却下理由・備考）
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS review_note TEXT;

-- B-1. 既存の CHECK 制約を削除 (§3 で 5 値追加版を再 ADD する)
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

-- B-2. 既存データの 'half_paid' を 'half_am' に更新
--      (§3 で新 CHECK 適用前に必ず実行する必要がある)
UPDATE public.leave_requests
   SET leave_type = 'half_am'
 WHERE leave_type = 'half_paid';

-- 注: §1 ではこれ以上 CHECK を ADD しない。
-- 原典 023 では旧 5 値版を ADD していたが、二重 ADD は §3 と競合するため省略。
-- §3 (029) で 10 値版を一括 ADD する。

-- =============================================================================
-- §2 (origin: 027) — correction_requests / leave_requests に store_id 追加
-- =============================================================================
ALTER TABLE public.correction_requests
  ADD COLUMN IF NOT EXISTS store_id UUID NULL REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_correction_requests_store_id
  ON public.correction_requests(store_id);

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS store_id UUID NULL REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_requests_store_id
  ON public.leave_requests(store_id);

-- =============================================================================
-- §3 (origin: 029) — leave_type CHECK に法定休暇 5 種追加 (§1 で旧 CHECK 削除済)
-- =============================================================================
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN (
    'paid','half_am','half_pm','absence','other',
    'special','maternity','paternity','compassionate','comp_holiday'
  ));

-- =============================================================================
-- §4 (origin: 024) — payroll_finalization
--   tenants.payroll_close_day + payroll_runs / payroll_run_items + RLS + INDEX
-- =============================================================================

-- A-1. tenants.payroll_close_day
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payroll_close_day SMALLINT NOT NULL DEFAULT 31
  CHECK (payroll_close_day BETWEEN 1 AND 31);

-- A-2. payroll_runs (月次確定の親)
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      uuid REFERENCES public.stores(id) ON DELETE SET NULL, -- NULL=全店舗
  target_month  date NOT NULL,  -- 月初日（YYYY-MM-01）
  close_day     smallint NOT NULL,  -- 締め日のスナップショット
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('actual','shift')),
  total_payment integer NOT NULL DEFAULT 0,
  finalized_at  timestamptz NOT NULL DEFAULT now(),
  finalized_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note          text,
  UNIQUE (tenant_id, store_id, target_month, mode)
);

-- A-3. payroll_run_items (個人別明細スナップショット)
CREATE TABLE IF NOT EXISTS public.payroll_run_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  pay_type        text NOT NULL CHECK (pay_type IN ('hourly','monthly')),
  hourly_rate     integer NOT NULL DEFAULT 0,
  monthly_salary  integer NOT NULL DEFAULT 0,
  work_days       integer NOT NULL DEFAULT 0,
  normal_minutes  integer NOT NULL DEFAULT 0,
  night_minutes   integer NOT NULL DEFAULT 0,
  payment         integer NOT NULL DEFAULT 0
);

-- A-4. RLS 有効化 (Postgres は既に有効でも no-op)
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_items ENABLE ROW LEVEL SECURITY;

-- payroll_runs policies (再走対策で前置 DROP)
DROP POLICY IF EXISTS pr_select ON public.payroll_runs;
CREATE POLICY pr_select ON public.payroll_runs FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pr_insert ON public.payroll_runs;
CREATE POLICY pr_insert ON public.payroll_runs FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tenant_members
            WHERE tenant_id = payroll_runs.tenant_id
              AND user_id = auth.uid()
              AND role IN ('owner','manager'))
  );

DROP POLICY IF EXISTS pr_delete ON public.payroll_runs;
CREATE POLICY pr_delete ON public.payroll_runs FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.tenant_members
            WHERE tenant_id = payroll_runs.tenant_id
              AND user_id = auth.uid()
              AND role IN ('owner','manager'))
  );

-- payroll_run_items policies (親 run の RLS に追従、再走対策で前置 DROP)
DROP POLICY IF EXISTS pri_select ON public.payroll_run_items;
CREATE POLICY pri_select ON public.payroll_run_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            WHERE r.id = payroll_run_items.run_id
              AND r.tenant_id IN (
                SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
              ))
  );

DROP POLICY IF EXISTS pri_insert ON public.payroll_run_items;
CREATE POLICY pri_insert ON public.payroll_run_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
            WHERE r.id = payroll_run_items.run_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','manager'))
  );

DROP POLICY IF EXISTS pri_delete ON public.payroll_run_items;
CREATE POLICY pri_delete ON public.payroll_run_items FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.payroll_runs r
            JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
            WHERE r.id = payroll_run_items.run_id
              AND tm.user_id = auth.uid()
              AND tm.role IN ('owner','manager'))
  );

-- A-5. インデックス
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_month
  ON public.payroll_runs (tenant_id, target_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_run_items_run
  ON public.payroll_run_items (run_id);

-- =============================================================================
-- §5 (origin: 030) — tenant_roles + tenant_members.role_id + RLS
--   §12 の tenant_members_visible が role_id を参照するため必ず §12 より前。
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_hourly_rate INTEGER NULL,         -- NULL ならフォールバック値なし
  default_monthly_salary INTEGER NULL,
  color TEXT NULL,                          -- 任意 (例: '#3b82f6'、UI バッジ用)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_roles_tenant
  ON public.tenant_roles(tenant_id, sort_order);

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS role_id UUID NULL REFERENCES public.tenant_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_members_role_id
  ON public.tenant_members(role_id);

ALTER TABLE public.tenant_roles ENABLE ROW LEVEL SECURITY;

-- 給与情報 (default_hourly_rate / default_monthly_salary) を含むため
-- SELECT は owner / manager のみに制限する。
DROP POLICY IF EXISTS "tenant_roles_select" ON public.tenant_roles;
CREATE POLICY "tenant_roles_select" ON public.tenant_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = tenant_roles.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','manager')
    )
  );

-- owner / manager のみ INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "tenant_roles_modify_owner_manager" ON public.tenant_roles;
CREATE POLICY "tenant_roles_modify_owner_manager" ON public.tenant_roles
  FOR ALL USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner','manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner','manager')
    )
  );

-- =============================================================================
-- §6 (origin: 026) — tenants.default_deadline_day + shift_preferences 締切ガード RLS
--   prod に残存している旧 policy "Users manage own shift_preferences" を必ず DROP する。
--   "Managers can view all shift_preferences" は manager 横断閲覧用に残置 (DROP しない)。
-- =============================================================================

-- C-1: tenants にデフォルト締切日カラムを追加
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_deadline_day SMALLINT NULL
  CHECK (default_deadline_day IS NULL OR default_deadline_day BETWEEN 1 AND 31);

-- C-2: 旧 policy を確実に DROP (prod 実態 + 再走対策の網羅)
DROP POLICY IF EXISTS "Users manage own shift_preferences" ON public.shift_preferences;
DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline" ON public.shift_preferences;
DROP POLICY IF EXISTS "shift_preferences_update_with_deadline" ON public.shift_preferences;
DROP POLICY IF EXISTS "shift_preferences_delete_self_or_manager" ON public.shift_preferences;

-- SELECT: 本人
CREATE POLICY "shift_preferences_select_self"
  ON public.shift_preferences
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
  );

-- INSERT: owner/manager はバイパス、staff は締切前のみ許可
CREATE POLICY "shift_preferences_insert_with_deadline"
  ON public.shift_preferences
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_id = shift_preferences.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
      OR
      NOT EXISTS (
        SELECT 1 FROM public.shift_submission_deadlines d
        WHERE d.tenant_id = shift_preferences.tenant_id
          AND d.store_id = shift_preferences.store_id
          AND d.target_month = date_trunc('month', shift_preferences.date)::date
          AND d.deadline_at < now()
      )
    )
  );

-- UPDATE: owner/manager はバイパス、staff は締切前のみ自分の行を許可
CREATE POLICY "shift_preferences_update_with_deadline"
  ON public.shift_preferences
  FOR UPDATE
  USING (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_id = shift_preferences.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT get_my_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_id = shift_preferences.tenant_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'manager')
      )
      OR (
        user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.shift_submission_deadlines d
          WHERE d.tenant_id = shift_preferences.tenant_id
            AND d.store_id = shift_preferences.store_id
            AND d.target_month = date_trunc('month', shift_preferences.date)::date
            AND d.deadline_at < now()
        )
      )
    )
  );

-- DELETE: 本人または owner/manager
CREATE POLICY "shift_preferences_delete_self_or_manager"
  ON public.shift_preferences
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = shift_preferences.tenant_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- 締切判定用インデックス
CREATE INDEX IF NOT EXISTS idx_ssd_lookup
  ON public.shift_submission_deadlines (tenant_id, store_id, target_month, deadline_at);

-- =============================================================================
-- §7 (origin: 025) — shift_presets RLS の 'admin' → 'manager' 整合
--   prod 実態: 022 系で既に is_tenant_owner(tenant_id) OR EXISTS(... role IN ('owner','manager')) の
--   強化版 policy が適用済 (Engineer 調査 2026-05-04 §5 参照)。
--   ローカル 025 ファイルの式 (EXISTS のみ) より prod 現行式の方が安全側で広い。
--   よって 037 では §7 を no-op とし、prod 現行 policy を保持する。
--   参考: もし環境間で policy 同期が必要になった場合は別 migration で対応する。
-- =============================================================================
-- (実 SQL なし — 意図的 no-op)

-- =============================================================================
-- §8 (origin: 031) — tenants.deleted_at + get_my_tenant_ids 再定義 + soft_delete_tenant
--   §6 の policy USING 式は遅延評価のため、§6 → §8 の順で問題なし
--   (関数定義置換は次回 SELECT 時に新定義が使われる)。
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at_null
  ON public.tenants(id) WHERE deleted_at IS NULL;

-- get_my_tenant_ids を「論理削除テナント除外」版に再定義
CREATE OR REPLACE FUNCTION public.get_my_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT tm.tenant_id
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = auth.uid()
      AND t.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_tenant(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.tenant_members
        WHERE role = 'owner'
          AND user_id = auth.uid()
          AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'permission denied: only owner can delete tenant' USING ERRCODE = '42501';
    END IF;

    UPDATE public.tenants
    SET deleted_at = now()
    WHERE id = p_tenant_id
      AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_tenant(UUID) TO authenticated;

-- =============================================================================
-- §9 (origin: 032) — transfer_tenant_ownership RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transfer_tenant_ownership(
  p_tenant_id UUID,
  p_new_owner_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  IF auth.uid() = p_new_owner_user_id THEN
    RAISE EXCEPTION 'cannot transfer ownership to yourself' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'permission denied: only owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_target_role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'target user is not a member of this tenant' USING ERRCODE = '23503';
  END IF;

  IF v_target_role <> 'manager' THEN
    RAISE EXCEPTION 'target user must be a manager (current role: %)', v_target_role USING ERRCODE = '22023';
  END IF;

  -- 譲渡先 → owner
  UPDATE public.tenant_members
    SET role = 'owner'
    WHERE tenant_id = p_tenant_id AND user_id = p_new_owner_user_id;

  -- 旧 owner → manager
  UPDATE public.tenant_members
    SET role = 'manager'
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid();

  -- tenants.owner_id 更新
  UPDATE public.tenants
    SET owner_id = p_new_owner_user_id
    WHERE id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_tenant_ownership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_tenant_ownership(UUID, UUID) TO authenticated;

-- =============================================================================
-- §10 (origin: 033) — tenants.invite_code_* + RPC 2 件
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invite_code_expires_at TIMESTAMPTZ NULL;
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invite_code_max_uses    INTEGER NULL
    CHECK (invite_code_max_uses IS NULL OR invite_code_max_uses > 0);
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invite_code_used_count  INTEGER NOT NULL DEFAULT 0
    CHECK (invite_code_used_count >= 0);

CREATE INDEX IF NOT EXISTS idx_tenants_invite_code_expires
  ON public.tenants(invite_code_expires_at)
  WHERE invite_code_expires_at IS NOT NULL;

-- atomic な使用回数加算 (joinTenant の race condition 緩和)
CREATE OR REPLACE FUNCTION public.increment_invite_code_use(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ;
  v_max_uses INTEGER;
  v_used_count INTEGER;
BEGIN
  SELECT invite_code_expires_at, invite_code_max_uses, invite_code_used_count
    INTO v_expires_at, v_max_uses, v_used_count
    FROM public.tenants
    WHERE id = p_tenant_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;

  IF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    RAISE EXCEPTION 'invite code max uses reached';
  END IF;

  UPDATE public.tenants
    SET invite_code_used_count = v_used_count + 1
    WHERE id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_invite_code_use(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_invite_code_use(UUID) TO authenticated;

-- atomic な招待コード join
CREATE OR REPLACE FUNCTION public.join_tenant_with_invite(
  p_invite_code TEXT,
  p_display_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_max_uses INTEGER;
  v_used_count INTEGER;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display name required';
  END IF;

  -- 招待コードでテナントを行ロック付き取得
  SELECT id, invite_code_expires_at, invite_code_max_uses, invite_code_used_count
    INTO v_tenant_id, v_expires_at, v_max_uses, v_used_count
    FROM public.tenants
    WHERE invite_code = p_invite_code
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite code not found';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;

  IF v_max_uses IS NOT NULL AND v_used_count >= v_max_uses THEN
    RAISE EXCEPTION 'invite code max uses reached';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_tenant_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already a member';
  END IF;

  INSERT INTO public.tenant_members (tenant_id, user_id, display_name, role)
  VALUES (v_tenant_id, v_user_id, p_display_name, 'staff');

  UPDATE public.tenants
    SET invite_code_used_count = v_used_count + 1
    WHERE id = v_tenant_id;

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_tenant_with_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_tenant_with_invite(TEXT, TEXT) TO authenticated;

-- =============================================================================
-- §11 (origin: 034) — tenant_members_delete_self_non_owner policy
-- =============================================================================

DROP POLICY IF EXISTS "tenant_members_delete_self_non_owner" ON public.tenant_members;
CREATE POLICY "tenant_members_delete_self_non_owner" ON public.tenant_members
  FOR DELETE USING (
    user_id = auth.uid()
    AND role <> 'owner'
  );

-- =============================================================================
-- §12 (origin: 036) — legal_name + onboarding (§5 の role_id が前提)
-- =============================================================================

-- A. legal_name + onboarded_at カラム追加
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS legal_name TEXT NULL;
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.tenant_members.legal_name IS
  '本名（社内表記用）。本人と owner/manager のみ可視。NULL は未入力（初回オンボーディング対象）。';
COMMENT ON COLUMN public.tenant_members.onboarded_at IS
  '初回オンボーディング完了タイムスタンプ。NULL は未完了。';

-- B. 列レベル GRANT/REVOKE — legal_name を authenticated から直接 SELECT させない
REVOKE SELECT ON public.tenant_members FROM authenticated;
GRANT SELECT (
  id, tenant_id, user_id, role, display_name,
  hourly_rate, night_shift_enabled, pay_type, monthly_salary,
  paid_leave_days, role_id, created_at, onboarded_at
) ON public.tenant_members TO authenticated;
-- legal_name は GRANT しない → 直接 SELECT 不可。ビュー経由のみ。

-- C. tenant_members_visible ビュー
CREATE OR REPLACE VIEW public.tenant_members_visible
WITH (security_invoker = true) AS
SELECT
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.display_name,
  CASE
    WHEN tm.user_id = auth.uid() THEN tm.legal_name
    WHEN EXISTS (
      SELECT 1 FROM public.tenant_members me
      WHERE me.tenant_id = tm.tenant_id
        AND me.user_id = auth.uid()
        AND me.role IN ('owner','manager')
    ) THEN tm.legal_name
    ELSE NULL
  END AS legal_name,
  tm.onboarded_at,
  tm.hourly_rate,
  tm.night_shift_enabled,
  tm.pay_type,
  tm.monthly_salary,
  tm.paid_leave_days,
  tm.role_id,
  tm.created_at
FROM public.tenant_members tm;

GRANT SELECT ON public.tenant_members_visible TO authenticated;

COMMENT ON VIEW public.tenant_members_visible IS
  '一般用 tenant_members ビュー。legal_name は self + owner/manager のみ可視。security_invoker により呼び出し元 RLS を継承。';

-- D. complete_onboarding RPC
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_tenant_id UUID,
  p_legal_name TEXT,
  p_display_name TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_legal_name IS NULL OR length(btrim(p_legal_name)) = 0 THEN
    RAISE EXCEPTION 'legal name required';
  END IF;
  IF length(btrim(p_legal_name)) > 50 THEN
    RAISE EXCEPTION 'legal name too long';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display name required';
  END IF;
  IF length(btrim(p_display_name)) > 30 THEN
    RAISE EXCEPTION 'display name too long';
  END IF;

  UPDATE public.tenant_members
    SET legal_name   = btrim(p_legal_name),
        display_name = btrim(p_display_name),
        onboarded_at = COALESCE(onboarded_at, now())
    WHERE tenant_id = p_tenant_id
      AND user_id   = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, TEXT, TEXT) TO authenticated;

-- E. night_shift_enabled DEFAULT を true に + 既存 NULL バックフィル
ALTER TABLE public.tenant_members
  ALTER COLUMN night_shift_enabled SET DEFAULT true;

UPDATE public.tenant_members
  SET night_shift_enabled = true
  WHERE night_shift_enabled IS NULL;

COMMENT ON COLUMN public.tenant_members.night_shift_enabled IS
  '深夜給（22:00〜翌5:00 で 1.25x）対象フラグ。DEFAULT true（飲食店ユースケース既定）。';

COMMIT;

-- =============================================================================
-- [ROLLBACK BLOCK]  ※通常実行しない。COMMIT 後の事後ロールバック用テンプレート。
-- =============================================================================
-- データ削除を含むため、事前バックアップ必須。
-- 削除対象:
--   tenant_roles 行 / payroll_runs / payroll_run_items 行
--   tenant_members.legal_name / onboarded_at 値
--   tenants.invite_code_* 累計値
--
-- BEGIN;
--   -- §12 戻し
--   DROP FUNCTION IF EXISTS public.complete_onboarding(UUID, TEXT, TEXT);
--   DROP VIEW IF EXISTS public.tenant_members_visible;
--   GRANT SELECT ON public.tenant_members TO authenticated;  -- 列指定戻し
--   ALTER TABLE public.tenant_members ALTER COLUMN night_shift_enabled DROP DEFAULT;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS onboarded_at;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS legal_name;
--   -- §11 戻し
--   DROP POLICY IF EXISTS "tenant_members_delete_self_non_owner" ON public.tenant_members;
--   -- §10 戻し
--   DROP FUNCTION IF EXISTS public.join_tenant_with_invite(TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.increment_invite_code_use(UUID);
--   DROP INDEX IF EXISTS public.idx_tenants_invite_code_expires;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS invite_code_used_count;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS invite_code_max_uses;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS invite_code_expires_at;
--   -- §9 戻し
--   DROP FUNCTION IF EXISTS public.transfer_tenant_ownership(UUID, UUID);
--   -- §8 戻し
--   DROP FUNCTION IF EXISTS public.soft_delete_tenant(UUID);
--   CREATE OR REPLACE FUNCTION public.get_my_tenant_ids()
--     RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
--     AS $$ SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid(); $$;
--   DROP INDEX IF EXISTS public.idx_tenants_deleted_at_null;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS deleted_at;
--   -- §6 戻し
--   DROP POLICY IF EXISTS "shift_preferences_delete_self_or_manager" ON public.shift_preferences;
--   DROP POLICY IF EXISTS "shift_preferences_update_with_deadline" ON public.shift_preferences;
--   DROP POLICY IF EXISTS "shift_preferences_insert_with_deadline" ON public.shift_preferences;
--   DROP POLICY IF EXISTS "shift_preferences_select_self" ON public.shift_preferences;
--   DROP INDEX IF EXISTS public.idx_ssd_lookup;
--   CREATE POLICY "Users manage own shift_preferences" ON public.shift_preferences
--     FOR ALL USING (user_id = auth.uid() AND tenant_id IN (SELECT get_my_tenant_ids()));
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS default_deadline_day;
--   -- §5 戻し
--   DROP INDEX IF EXISTS public.idx_tenant_members_role_id;
--   ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS role_id;
--   DROP TABLE IF EXISTS public.tenant_roles CASCADE;
--   -- §4 戻し
--   DROP INDEX IF EXISTS public.idx_payroll_run_items_run;
--   DROP INDEX IF EXISTS public.idx_payroll_runs_tenant_month;
--   DROP TABLE IF EXISTS public.payroll_run_items CASCADE;
--   DROP TABLE IF EXISTS public.payroll_runs CASCADE;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS payroll_close_day;
--   -- §3 戻し
--   ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
--   ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_leave_type_check
--     CHECK (leave_type IN ('paid','half_paid','absence','other'));
--   -- §2 戻し
--   DROP INDEX IF EXISTS public.idx_leave_requests_store_id;
--   DROP INDEX IF EXISTS public.idx_correction_requests_store_id;
--   ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS store_id;
--   ALTER TABLE public.correction_requests DROP COLUMN IF EXISTS store_id;
--   -- §1 戻し
--   ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS review_note;
--   UPDATE public.leave_requests SET leave_type='half_paid' WHERE leave_type='half_am';
-- COMMIT;

-- =============================================================================
-- 適用後の検証 SQL リスト (dev branch / prod の両方で適用直後に実行)
-- =============================================================================

-- §5.1 schema_migrations 確認
-- SELECT version, name FROM supabase_migrations.schema_migrations
--  ORDER BY version DESC LIMIT 5;
-- 期待最上位: 20260504200000 / 037_consolidated_catchup

-- §5.2 列追加チェック (12 件)
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema='public'
--    AND (table_name, column_name) IN (
--      ('tenant_members','role_id'),
--      ('tenant_members','legal_name'),
--      ('tenant_members','onboarded_at'),
--      ('tenants','payroll_close_day'),
--      ('tenants','default_deadline_day'),
--      ('tenants','deleted_at'),
--      ('tenants','invite_code_expires_at'),
--      ('tenants','invite_code_max_uses'),
--      ('tenants','invite_code_used_count'),
--      ('leave_requests','review_note'),
--      ('leave_requests','store_id'),
--      ('correction_requests','store_id')
--    )
--  ORDER BY table_name, column_name;
-- 期待: 12 行

-- §5.3 テーブル追加チェック
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public'
--    AND table_name IN ('tenant_roles','payroll_runs','payroll_run_items')
--  ORDER BY table_name;
-- 期待: 3 行

-- §5.4 ビュー追加チェック
-- SELECT table_name FROM information_schema.views
--  WHERE table_schema='public' AND table_name='tenant_members_visible';
-- 期待: 1 行

-- §5.5 RPC 追加チェック
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public'
--    AND proname IN (
--      'soft_delete_tenant',
--      'transfer_tenant_ownership',
--      'increment_invite_code_use',
--      'join_tenant_with_invite',
--      'complete_onboarding',
--      'get_my_tenant_ids'
--    )
--  ORDER BY proname;
-- 期待: 6 行 (get_my_tenant_ids は再定義済)

-- §5.6 RLS policy 確認
-- SELECT polname FROM pg_policy
--  WHERE polrelid = 'public.shift_preferences'::regclass
--  ORDER BY polname;
-- 期待: shift_preferences_delete_self_or_manager
--       shift_preferences_insert_with_deadline
--       shift_preferences_select_self
--       shift_preferences_update_with_deadline
--       Managers can view all shift_preferences (残存)
--
-- SELECT polname FROM pg_policy
--  WHERE polrelid = 'public.tenant_members'::regclass
--  ORDER BY polname;
-- 期待: tenant_members_delete_self_non_owner を含む
--
-- SELECT polname FROM pg_policy
--  WHERE polrelid = 'public.tenant_roles'::regclass
--  ORDER BY polname;
-- 期待: tenant_roles_modify_owner_manager / tenant_roles_select の 2 件
--
-- SELECT polname FROM pg_policy
--  WHERE polrelid = 'public.payroll_runs'::regclass
--  ORDER BY polname;
-- 期待: pr_delete / pr_insert / pr_select の 3 件
--
-- SELECT polname FROM pg_policy
--  WHERE polrelid = 'public.payroll_run_items'::regclass
--  ORDER BY polname;
-- 期待: pri_delete / pri_insert / pri_select の 3 件

-- §5.7 leave_type CHECK 確認
-- SELECT pg_get_constraintdef(c.oid)
--   FROM pg_constraint c
--   JOIN pg_class t ON t.oid = c.conrelid
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--  WHERE n.nspname='public'
--    AND t.relname='leave_requests'
--    AND c.conname='leave_requests_leave_type_check';
-- 期待: CHECK (leave_type = ANY (ARRAY['paid','half_am','half_pm','absence','other',
--                'special','maternity','paternity','compassionate','comp_holiday']))

-- §5.8 列レベル GRANT 確認 (§12)
-- SELECT column_name, privilege_type
--   FROM information_schema.column_privileges
--  WHERE table_schema='public' AND table_name='tenant_members'
--    AND grantee='authenticated' AND privilege_type='SELECT'
--  ORDER BY column_name;
-- 期待: legal_name 行が「無い」こと、その他 13 列が SELECT 権限あり

-- §5.9 ビュー動作スモーク
-- (実行ユーザは authenticated 想定)
-- SELECT id, user_id, legal_name FROM public.tenant_members_visible LIMIT 1;
-- 期待: legal_name は self/owner/manager で値、staff の他人行は NULL

-- §5.10 advisor 再確認
-- mcp__supabase__get_advisors(project_id='zjjbfffhbobwwxyvdszl', type='security')
-- 期待: 適用前 (LV WARN 13 件) と比較し、新規 WARN 増加なし
-- =============================================================================
