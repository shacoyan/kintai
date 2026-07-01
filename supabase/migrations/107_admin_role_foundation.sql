-- =============================================================================
-- 107_admin_role_foundation.sql
-- kintai 権限管理UI化 P3-0b — admin(会社管理者)役職の土台（挙動不変・RLS述語差し替えゼロ）
-- 設計: .company/engineering/docs/2026-07-01-kintai-permissions-p3-0b-admin-role.md
--       （正本 2026-07-01-kintai-permissions-phase3-architecture.md ＋ addendum、矛盾時 addendum 優先）
--
-- 【このバッチが行うこと（土台のみ・挙動完全不変）】
--   (A) tenant_members.role の CHECK を {owner,manager,staff} → {owner,admin,manager,staff} に拡張
--   (B) tenant_view_scopes.role の CHECK を同様に拡張（105 のインライン自動生成名 → named に張り替え）
--   (C) is_tenant_managerial(058) を role IN ('owner','admin','manager') へ拡張（admin=managerial）
--   (D) is_tenant_owner(009) は一切変更しない（owner 専用の唯一の担保・admin を絶対に含めない）
--   RLS/RPC/VIEW の述語は1つも差し替えない。tenant_view_scopes に admin プリセット行を seed しない。
--
-- 【新設 admin と 001 旧 admin の無関係性（将来の読者の誤読防止）】
--   本 migration が新設する admin は「会社管理者」（owner と manager の間・全店会社管理）である。
--   001_initial_schema.sql:15 の旧 `admin`（CHECK role IN ('owner','admin','staff')）は
--   017_multi_store_role_and_manager.sql で全件 'manager' にリネームされ消滅した別役職であり、
--   本 admin とは【無関係】。017 の末尾ロールバックコメント（CHECK role IN ('owner','admin','staff')）は
--   旧 admin 前提の3値であり、本 migration が作る4値 {owner,admin,manager,staff} とは別物。
--   017 を逆手順で戻しても本 admin は復活しない。
--
-- 【挙動不変（no-op）の根拠】
--   現状 tenant_members.role に 'admin' は1行も存在しない（001→017 で旧 admin は manager へ全件リネーム）。
--   ・(A)(B) CHECK 拡張 = 許可集合の拡大（{owner,manager,staff} ⊂ {owner,admin,manager,staff}）。
--     既存行は全て拡大集合に属し ADD 検証に失敗せず、DDL は行を書き換えない → 既存 rowset 完全不変。
--   ・(C) is_tenant_managerial の admin 追加 = マッチ行ゼロ。任意の (tenant, auth.uid()) で
--     EXISTS(role IN ('owner','manager')) と EXISTS(role IN ('owner','admin','manager')) は恒等的に一致
--     → 本 helper に依存する全 RLS/RPC/VIEW（16 migration）の評価は現状と bit 一致。
--   ・(D) is_tenant_owner 不変 → owner 判定も完全不変。
--   admin が実運用可能になるのは後続バッチ（P3-1 → P3-2〜P3-8 の RLS 一般化 → P3-6 の admin 任命UI）以降。
--
-- 【本番未適用】この migration ファイルは作成のみ。適用は秘書の本番ゲート
--   （BEGIN..ROLLBACK で admin=0・rowset bit 一致・advisor 非増悪を実測 → 承認後 COMMIT）で行う。
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (A) tenant_members.role CHECK 張り替え（既知命名済み制約 = tenant_members_role_check）
--     017_multi_store_role_and_manager.sql:54-62 で明示命名済み。冪等（DROP IF EXISTS）。
--     既存行は全て owner|manager|staff（admin 0件）→ 拡大集合に含まれ ADD は失敗しない。
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD  CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'staff'));

-- ---------------------------------------------------------------------------
-- (B) tenant_view_scopes.role CHECK 張り替え
--     105_view_scopes_store_rls.sql:45 は role text NOT NULL CHECK (role IN ('owner','manager','staff'))
--     の【インライン CHECK】＝Postgres 自動生成名。慣例名は tenant_view_scopes_role_check
--     （{table}_{column}_check）だが、実名は pg_constraint で必ず確認してから DROP する。
--
--     ★秘書は本番ゲートで下記 SELECT を先に実行し実名を確定すること。
--       慣例名と異なる場合は、下の DROP 対象名を実名へ差し替えてから適用する。
--         SELECT conname, pg_get_constraintdef(oid) AS def
--         FROM pg_constraint
--         WHERE conrelid = 'public.tenant_view_scopes'::regclass
--           AND contype = 'c'
--           AND pg_get_constraintdef(oid) ILIKE '%role%';
--
--     domain / scope の CHECK は本バッチでは【触らない】（105 の3値のまま）。
--     admin プリセット行は seed しない（fail-open 温存・split-brain 面積を増やさない）。
--     ADD は named 制約で付け直す（以降の張り替えを容易化）。
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_view_scopes
  DROP CONSTRAINT IF EXISTS tenant_view_scopes_role_check;
ALTER TABLE public.tenant_view_scopes
  ADD  CONSTRAINT tenant_view_scopes_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'staff'));

-- ---------------------------------------------------------------------------
-- (C) is_tenant_managerial(058) を admin=managerial へ拡張
--     唯一の変更点: role IN ('owner','manager') → role IN ('owner','admin','manager')。
--     058_tasks_projects_rls_and_helpers.sql:14-28 の属性を【逐語一致】で維持:
--       LANGUAGE sql / STABLE / SECURITY DEFINER / SET search_path = public, pg_temp /
--       戻り BOOLEAN / シグネチャ public.is_tenant_managerial(p_tenant_id uuid)。
--     CREATE OR REPLACE（DROP しない）で依存する16 migration の関数参照を切らない（42883 窓なし）。
--     4行テンプレ（REVOKE PUBLIC / REVOKE anon / GRANT authenticated）を明示再掲し anon 除外証跡を残す。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tenant_managerial(p_tenant_id uuid)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner','admin','manager')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_tenant_managerial(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- (D) is_tenant_owner(009) は変更しない
--     会社削除 / owner 権限移譲 / 課金 / owner 自身の権限変更 / 権限設定RPC(set_view_scope 等) は
--     全て is_tenant_owner ゲート。ここに admin が混ざると owner 専用操作が admin に漏れ、
--     権限境界が崩壊する。admin を【絶対に追加しない】= owner 専用の唯一の担保。
--     （009 が search_path に pg_temp を含まない点も既知の据え置き事項・本バッチでは触らない。）
-- ---------------------------------------------------------------------------
-- （intentionally no-op: is_tenant_owner は現状維持）

COMMIT;

-- =============================================================================
-- ロールバック手順（参考・実行しない）
--   admin 該当0の間は完全 no-op のためロールバック不要。万一戻す場合（本 admin=4値前提・
--   017 の旧 admin 逆手順とは別物）:
--     1. is_tenant_managerial を 058 本体（role IN ('owner','manager')）へ CREATE OR REPLACE で戻す
--        （4行テンプレ再掲）。
--     2. tenant_members: DROP CONSTRAINT IF EXISTS tenant_members_role_check;
--        → ADD ... CHECK (role IN ('owner','manager','staff'));  （戻す前に admin 該当行が無いこと確認）
--     3. tenant_view_scopes: 同様に role CHECK を ('owner','manager','staff') へ戻す（admin 行が無いこと確認）
--     4. is_tenant_owner(009) は本バッチで未変更 → 戻す対象なし
--   フロント（型・can.ts・ラベル・テスト）は git revert。DB を先に戻し、その後フロントを戻す。
-- =============================================================================
