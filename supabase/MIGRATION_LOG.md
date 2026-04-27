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
