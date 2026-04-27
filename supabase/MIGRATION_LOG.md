# Kintai マイグレーション適用ログ

## 適用済みマイグレーション

| # | ファイル | 内容 | 適用日 |
|---|---------|------|--------|
| 001 | `001_initial_schema.sql` | tenants, tenant_members, attendance_records テーブル作成 + RLS | 初期 |
| 002 | `002_fix_rls_recursion.sql` | RLS無限再帰修正、`get_my_tenant_ids()` 関数作成 | 初期 |
| 003 | `003_multi_session_breaks_corrections.sql` | breaks テーブル、correction_requests テーブル作成、複数出退勤対応 | 初期 |
| 004 | `004_add_hourly_rate.sql` | tenant_members に `hourly_rate` カラム追加 + owner更新ポリシー | 2026-04-06 |
| 005 | `005_add_request_type.sql` | correction_requests に `request_type` カラム追加 (correction/delete) | 2026-04-06 |
| 006 | `006_add_night_shift.sql` | tenant_members に `night_shift_enabled` カラム追加 | 2026-04-06 |
| 007 | `007_admin_attendance_rls.sql` | attendance_records に admin用 UPDATE/DELETE RLSポリシー追加 | 2026-04-06 |
| 008 | `008_fix_tenant_members_update_rls.sql` | tenant_members UPDATE RLS無限再帰修正、`is_tenant_owner()` 関数作成 | 2026-04-06 |
| 017 | `017_multi_store_role_and_manager.sql` | ロール語彙 admin→manager / store_members.is_manager / shift_preferences.store_id / RLS 再構築 | 2026-04-26 |
| 018 | `018_loop_b_unique_keys_and_preset_scope.sql` | shift_preferences の UNIQUE を (tenant,user,date,store_id) に組み替え + NULL データ削除 | 2026-04-26 |
| 023 | `023_leave_review_note_and_half.sql` | leave_requests に review_note 追加、半休タイプ(half_paid)を half_am/half_pm に細分化 | 2026-04-27 |
<!-- --- Loop 7 (Engineer C) --- -->
| 026 | `026_deadline_guard_and_default.sql` | tenants.default_deadline_day 追加 + shift_preferences の RLS を締切ガード付きに再構築（owner/manager は締切後もバイパス、staff は締切後 INSERT/UPDATE 拒否） | 2026-04-27 |

## 備考

- 004〜007 は 2026-04-06 にまとめて手動適用（Supabase SQL Editor）
- 004 のポリシー `owner_can_update_hourly_rate` は 008 で `owner_can_update_tenant_members` に置換
- 005 の `request_type` カラムは CHECK制約付きのため DO $$ ブロックで条件付き作成

--- Loop 7 (Engineer B) ---

| # | ファイル | 内容 | 適用日 |
|---|---------|------|--------|
| 025 | `025_shift_presets_update_rls.sql` | shift_presets の INSERT/UPDATE/DELETE ポリシーを role IN ('owner','manager') に統一（'admin' 廃止対応 + UPDATE 明示） | 2026-04-27 |

--- Loop 7 (Engineer A) ---

| # | ファイル | 内容 | 適用日 |
|---|---------|------|--------|
| 024 | `024_payroll_finalization.sql` | tenants.payroll_close_day 追加 / payroll_runs / payroll_run_items テーブル作成 + RLS（owner/manager INSERT・DELETE / 全テナントメンバー SELECT） + インデックス | 2026-04-27 |

--- Loop 11a (Engineer C) ---

| # | ファイル | 内容 | 適用日 |
|---|---------|------|--------|
| 027 | `027_correction_leave_store_id.sql` | correction_requests / leave_requests に `store_id UUID NULL REFERENCES stores(id) ON DELETE SET NULL` カラム追加 + idx_*_store_id インデックス。RLS は tenant_id ベースを維持 (表示用補足) | 2026-04-27 |

--- Loop 11b Phase 1 ---

| # | ファイル | 内容 | 適用日 |
|---|---------|------|--------|
| 028 | `028_notifications.sql` | notifications テーブル新設 (tenant_id / user_id / type CHECK 10種 / title / body / link / read_at / created_at) + idx 3本 (user_unread / user_recent / tenant) + RLS 4ポリシー (受信者 SELECT/UPDATE/DELETE own、同 tenant の owner/manager のみ INSERT 可で受信者 user_id が同 tenant member であることを WITH CHECK で検証) | 2026-04-28 |
| 029 | `029_leave_type_extend.sql` | leave_requests.leave_type CHECK 制約拡張 — 既存 (paid/half_am/half_pm/absence/other) に法定休暇 5種 (special/maternity/paternity/compassionate/comp_holiday) 追加 | 2026-04-28 |
| 030 | `030_tenant_roles.sql` | tenant_roles テーブル新設 (役職マスタ: name / default_hourly_rate / default_monthly_salary / color / sort_order) + tenant_members.role_id (FK ON DELETE SET NULL) 追加 + RLS (tenant 所属者 SELECT / owner・manager のみ INSERT/UPDATE/DELETE) | 2026-04-28 |
| 031 | `031_tenant_soft_delete.sql` | tenants.deleted_at TIMESTAMPTZ 追加 + 部分インデックス (deleted_at IS NULL) + `get_my_tenant_ids()` 再定義 (deleted_at IS NULL の tenants と JOIN) + `soft_delete_tenant(p_tenant_id UUID)` SECURITY DEFINER RPC (オーナーのみ実行可能) + REVOKE PUBLIC / GRANT authenticated | 2026-04-28 |
| 032 | `032_transfer_ownership.sql` | `transfer_tenant_ownership(p_tenant_id, p_new_owner_user_id)` SECURITY DEFINER RPC 追加 — 旧 owner→manager 降格・新 owner (manager 限定) →owner 昇格・tenants.owner_id 更新を atomic 実行 / 自分自身指定・非 owner 呼び出し・非 manager 譲渡先・非 member 譲渡先を例外化 + REVOKE PUBLIC / GRANT authenticated | 2026-04-28 |
