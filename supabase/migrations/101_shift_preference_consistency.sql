-- ============================================================
-- 101_shift_preference_consistency.sql
-- シフト⇔希望(shift_preferences)の整合性をDB側で原子的に保証する
--   設計書: .company/engineering/docs/2026-06-19-kintai-batch-b-shift-preference-consistency.md
--   作成日: 2026-06-19  リスクティア: L (DDL + RLS関数 + 認可)
--
-- 背景 / なぜ:
--   approvePreference (preference UPDATE + shifts INSERT) / revertPreference /
--   一括承認・却下が フロント側で複数ステートメントに分かれ非原子 (途中失敗で孤児/
--   不整合)、かつ N+1 (for..of await)。本承認済みシフトとリンク希望の双方向同期も
--   欠落していた (P1-3 / P1-5 / P2-3 / P2-2)。これらを SECURITY DEFINER RPC に集約し
--   単一トランザクション化する。
--
-- 前提 (適用前に秘書ゲートで read-only 確認済 = 本ファイル末尾 検証SQL #A):
--   - shifts の 4列複合 (tenant_id,user_id,date,store_id) の重複 = 0件 (実測 2026-06-19)
--   - shifts.store_id IS NULL = 0件 (実測)。total=251。
--   - 旧UNIQUE制約名 = shifts_tenant_id_user_id_date_key (実測 = 想定一致)
--   - shifts トリガ = trg_shifts_enforce_insert_status(086) /
--                    trg_shifts_enforce_approval_order(054) /
--                    trg_shifts_enforce_time_update(100) の3本 (実測)
--
-- Depends on:
--   012(shifts定義/旧UNIQUE) 015(store_id) 018(参考) 035(preference status+notif type)
--   053/054(二段承認/reject_shift) 055(revert_shift_to_tentative)
--   086(INSERT status矯正) 096(shifts.preference_id) 097(set-based型紙) 100(time改ざんトリガ)
--
-- トリガ相互作用 (崩さないこと):
--   本RPCは全て SECURITY DEFINER。内部 auth.uid() は呼出元(owner/manager)を返すため
--   086(各行 owner/manager判定→tentative温存) / 100(time改ざん判定1で通過) を阻害しない。
--   054(status遷移ガード) は escape hatch GUC (app.allow_direct_*) で通過させる。
--   INSERT...SELECT の複数行 INSERT でも 086 は各行で判定するため全行 tentative 温存。
--
-- 設計上の重要判断 (Reviewer 論点):
--   1. revert_shift_to_tentative (approved→tentative) では preference は approved 維持。
--      二段承認モデルでは「仮承認シフトが残る=希望はまだ承認状態」が正。過剰 pending 化禁止。
--      ただし preference_id 先が誤って rejected/pending に落ちている異常時のみ approved へ復元。
--   2. revert_preference (希望→pending) こそ P1-3 本命。リンク仮承認シフト(tentative/pending)を
--      削除し、本承認済み(approved)シフトが在る場合は明示 RAISE でブロック (孤児温存しない)。
--   3. ON CONFLICT DO UPDATE は approved/rejected/cancelled を不可触 (WHERE ガード)。
--      既存本承認済みシフトを希望再承認で巻き戻さない。per-item で更新不能なら明示 RAISE。
--   4. reject_shift は生成元 preference を rejected 同期。通知は shift_rejected のみ
--      (preference_rejected を二重で出さない)。
--   5. 一括は ids 配列版 (approve_preferences / reject_preferences) を第一候補
--      (UI が個別選択 ids を保持するため最小侵襲)。override は一括非対応。
--   6. authz は per-item / 一括ともに同一の二段ゲート
--      (owner/manager EXISTS AND store_members.is_manager=true)。is_store_manager 単独
--      OR 判定は使わない (スタッフ店長の権限昇格を防ぐ)。
-- ============================================================

BEGIN;

-- ============================================================
-- (a) shifts UNIQUE を 4列複合へ組替 — P2-2
--   旧: UNIQUE(tenant_id,user_id,date)  →  新: UNIQUE(tenant_id,user_id,date,store_id)
--   これにより「同一 user / 同一 date / 別 store」の複数シフトを許容する。
--   ★本番データありのため 018 の無条件 DELETE は流用しない (本ファイルに DELETE 無し)。
--   ★4列複合の重複が 0件 であることを前提とする (末尾 #A・適用前に秘書ゲートで再確認)。
--   冪等: DROP は IF EXISTS、ADD は pg_constraint 不在チェックの DO ブロック。
-- ============================================================
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_tenant_id_user_id_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shifts'::regclass
      AND conname  = 'shifts_tenant_user_date_store_key'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_tenant_user_date_store_key
      UNIQUE (tenant_id, user_id, date, store_id);
  END IF;
END $$;

-- ============================================================
-- (b) approve_preference — 希望承認を原子化 (per-item / override対応) — P2-3
--   preference UPDATE(→approved) + shifts INSERT(tentative・preference_id記録) + 通知 を
--   単一 tx に集約。ON CONFLICT(4列) で冪等。本承認済みシフトは不可触。
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_preference(
  p_preference_id uuid,
  p_override_start time DEFAULT NULL,
  p_override_end   time DEFAULT NULL
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref   public.shift_preferences%ROWTYPE;
  v_start  time;
  v_end    time;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULL チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 希望を行ロック付きで取得 + 存在チェック
  SELECT * INTO v_pref
  FROM public.shift_preferences
  WHERE id = p_preference_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift preference not found: %', p_preference_id;
  END IF;

  -- 3. unavailable は 035 トリガで提出時 approved 確定 → シフト INSERT しない。
  --    既に approved の場合は多重呼び出しレース対策で no-op early return。
  IF v_pref.preference_type = 'unavailable' AND v_pref.status = 'approved' THEN
    RETURN NULL;
  END IF;

  -- 4. 店舗未紐付けは承認不可
  IF v_pref.store_id IS NULL THEN
    RAISE EXCEPTION 'shift preference has no store_id: %', p_preference_id;
  END IF;

  -- 5. 二段ゲート authz (reject_shift / 097 と同条件):
  --    owner/manager かつ その店舗の store_members.is_manager=true。
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id   = auth.uid()
      AND tm.tenant_id = v_pref.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id  = v_pref.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 6. 時刻決定 (override 優先)。NULL は承認不可。
  v_start := COALESCE(p_override_start, v_pref.start_time);
  v_end   := COALESCE(p_override_end,   v_pref.end_time);
  IF v_start IS NULL OR v_end IS NULL THEN
    RAISE EXCEPTION 'start/end time is not set for preference %', p_preference_id;
  END IF;

  -- 7. 希望を承認済みへ (既存 approvePreference の無条件 UPDATE 挙動を維持)
  UPDATE public.shift_preferences SET status = 'approved' WHERE id = p_preference_id;

  -- 8. escape hatch: ON CONFLICT DO UPDATE で pending→tentative 遷移が起きうるため
  --    054 トリガを通過させる。
  PERFORM set_config('app.allow_direct_tentative', '1', true);

  -- 9. 仮承認シフトを生成 (ON CONFLICT 4列複合で冪等)。
  --    DO UPDATE は確定前 status (pending/tentative/modified) のみ更新可。
  --    approved/rejected/cancelled は WHERE で除外 → conflict 時 RETURNING 0行。
  INSERT INTO public.shifts (
    tenant_id, user_id, date, start_time, end_time, status,
    tentative_approved_by, tentative_approved_at, note, store_id, preference_id
  ) VALUES (
    v_pref.tenant_id, v_pref.user_id, v_pref.date, v_start, v_end, 'tentative',
    auth.uid(), now(), v_pref.note, v_pref.store_id, v_pref.id
  )
  ON CONFLICT (tenant_id, user_id, date, store_id) DO UPDATE
    SET start_time    = EXCLUDED.start_time,
        end_time      = EXCLUDED.end_time,
        preference_id = EXCLUDED.preference_id
    WHERE public.shifts.status IN ('pending', 'tentative', 'modified')
  RETURNING * INTO v_result;

  -- 10. conflict 先が approved/rejected/cancelled で DO UPDATE 条件を満たさない場合、
  --     RETURNING が 0行 (v_result.id IS NULL)。無音にせず明示 RAISE。
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION '既に確定済みのシフトがあるため希望を承認できません (date=%, store=%)',
      v_pref.date, v_pref.store_id;
  END IF;

  -- 11. 通知 (現フロント approvePreference と完全一致)
  INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
  VALUES (
    v_pref.tenant_id, v_pref.user_id, 'preference_approved',
    'シフト申請が承認されました', NULL,
    '/shift?tab=preferences&date=' || v_pref.date::text
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_preference(uuid, time, time) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_preference(uuid, time, time) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_preference(uuid, time, time) TO authenticated;

-- ============================================================
-- (c-1) revert_preference — 希望を保留(pending)へ戻すのを原子化 (P1-3 本命)
--   リンク仮承認シフト(tentative/pending)を削除し、本承認済み(approved)が在れば
--   明示 RAISE でブロック。希望だけ pending にして孤児を残さない。
-- ============================================================
CREATE OR REPLACE FUNCTION public.revert_preference(
  p_preference_id uuid
)
RETURNS public.shift_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref   public.shift_preferences%ROWTYPE;
  v_result public.shift_preferences%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULL チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 希望を行ロック付き取得 + 存在チェック
  SELECT * INTO v_pref
  FROM public.shift_preferences
  WHERE id = p_preference_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift preference not found: %', p_preference_id;
  END IF;

  -- 3. 既に pending なら no-op early return
  IF v_pref.status = 'pending' THEN
    RETURN v_pref;
  END IF;

  -- 4. 二段ゲート authz (preference の store_id で判定)
  IF v_pref.store_id IS NULL THEN
    RAISE EXCEPTION 'shift preference has no store_id: %', p_preference_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id   = auth.uid()
      AND tm.tenant_id = v_pref.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id  = v_pref.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. 本承認済み(approved)シフトがリンクされている場合はブロック
  --    (先にシフトを差し戻す必要がある。希望だけ pending にして孤児を残さない)
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE preference_id = p_preference_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '本承認済みのシフトがあるため希望を保留に戻せません。先にシフトを差し戻してください';
  END IF;

  -- 6. リンクされた仮承認シフト(tentative/pending)を削除 (096 の preference_id 厳密削除)
  DELETE FROM public.shifts
  WHERE preference_id = p_preference_id
    AND status IN ('tentative', 'pending');

  -- 7. 希望を pending へ
  UPDATE public.shift_preferences
  SET status = 'pending'
  WHERE id = p_preference_id
  RETURNING * INTO v_result;

  -- 8. 通知 (現フロント revertPreference と一致)
  INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
  VALUES (
    v_pref.tenant_id, v_pref.user_id, 'preference_reverted',
    'シフト申請のステータスが戻されました', NULL,
    '/shift?tab=preferences'
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revert_preference(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_preference(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revert_preference(uuid) TO authenticated;

-- ============================================================
-- (c-2) revert_shift_to_tentative 改修 (055 を CREATE OR REPLACE・シグネチャ不変)
--   既存ロジック完全維持 + リンク希望の最小同期を追加。
--   approved→tentative では preference は approved 維持が正 (論点1)。
--   ただし preference_id 先が誤って rejected/pending に落ちている異常時のみ approved へ復元。
-- ============================================================
CREATE OR REPLACE FUNCTION public.revert_shift_to_tentative(
  p_shift_id uuid
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック (二段ゲート)
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = v_shift.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id = v_shift.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. 状態遷移チェック: approvedのみ差し戻し可能
  IF v_shift.status <> 'approved' THEN
    RAISE EXCEPTION 'cannot revert: not in approved state, current=%', v_shift.status;
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_tentative', '1', true);

  -- 7. approved → tentative へ更新
  --    tentative_approved_by / tentative_approved_at は触らない
  UPDATE public.shifts
  SET status      = 'tentative',
      reviewed_by = NULL,
      reviewed_at = NULL
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. リンク希望の最小同期 (論点1):
  --    仮承認シフトが残る = 希望は approved 維持が正。過剰 pending 化しない。
  --    preference_id 先が誤って approved 以外に落ちている異常時のみ approved へ復元。
  IF v_shift.preference_id IS NOT NULL THEN
    UPDATE public.shift_preferences
    SET status = 'approved'
    WHERE id = v_shift.preference_id
      AND status <> 'approved';
  END IF;

  -- 9. 結果返却
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revert_shift_to_tentative(uuid) TO authenticated;

-- ============================================================
-- (c-3) reject_shift 改修 (054 を CREATE OR REPLACE・シグネチャ不変)
--   既存ロジック完全維持 + 生成元 preference を rejected 同期。
--   通知は shift_rejected のみ (preference_rejected を二重で出さない・論点4)。
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_shift(
  p_shift_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_result public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULLチェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 対象シフトを行ロック付きで取得
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  -- 3. 存在チェック
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found: %', p_shift_id;
  END IF;

  -- 4. 権限チェック (二段ゲート)
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.store_members sm ON sm.member_id = tm.id
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = v_shift.tenant_id
      AND tm.role IN ('owner', 'manager')
      AND sm.store_id = v_shift.store_id
      AND sm.is_manager = true
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. 状態遷移チェック: pending / tentative / modified のみ却下可能
  IF v_shift.status NOT IN ('pending', 'tentative', 'modified') THEN
    RAISE EXCEPTION 'cannot reject shift with status: %', v_shift.status;
  END IF;

  -- 6. escape hatch: trigger 経由 RPC として通過させる
  PERFORM set_config('app.allow_direct_reject', '1', true);

  -- 7. 却下へ更新 (note は p_reason があれば上書き)
  UPDATE public.shifts
  SET status      = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      note        = COALESCE(p_reason, note)
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 8. 生成元 preference を rejected 同期 (論点4)。
  --    035 の unavailable auto-approve トリガは preference_type='unavailable' のみ作用するため
  --    preferred/available の rejected 化は阻害されない。
  IF v_shift.preference_id IS NOT NULL THEN
    UPDATE public.shift_preferences
    SET status = 'rejected'
    WHERE id = v_shift.preference_id;
  END IF;

  -- 9. 結果返却 (通知は呼出側=既存 useShift.rejectShift が shift_rejected を出す。
  --    preference_rejected を二重で出さない)
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_shift(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_shift(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reject_shift(uuid, text) TO authenticated;

-- ============================================================
-- (d-1) approve_preferences(p_ids uuid[]) — 希望一括承認の set-based RPC — P1-5
--   N+1 (for..of await) を単一 tx の set-based に置換。override は一括非対応。
--   authz: targets 全行について二段ゲートを満たすことを保証 (1つでも権限外なら全体 RAISE)。
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_preferences(
  p_ids uuid[]
)
RETURNS TABLE(approved_count integer, approved_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_ids   uuid[];
BEGIN
  -- 1. auth.uid() NULL チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 入力チェック
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::integer, ARRAY[]::uuid[];
    RETURN;
  END IF;

  -- 3. 対象を行ロック取得。承認可能 = pending・preferred・時刻あり。
  --    preference_type CHECK は ('preferred','unavailable') の2値のみ (本番実測 2026-06-19)。
  --    unavailable は提出時 approved 確定 (035) なので承認対象外。よって preferred のみ。
  --    時刻欠落は一括対象外 (per-item approve_preference で個別承認)。
  --    ※ TEMP TABLE は使わない (同一 tx で approve→reject を呼ぶと名前衝突 42P07 になるため・
  --       単一文の CTE で完結させる)。先に PERFORM ... FOR UPDATE で行ロックを取る。
  PERFORM 1
  FROM public.shift_preferences sp
  WHERE sp.id = ANY(p_ids)
    AND sp.status = 'pending'
    AND sp.preference_type = 'preferred'
    AND sp.start_time IS NOT NULL
    AND sp.end_time   IS NOT NULL
    AND sp.store_id   IS NOT NULL
  FOR UPDATE;

  -- 4. authz: targets 全行が二段ゲートを満たすか。1件でも権限外なら全体 RAISE。
  IF EXISTS (
    SELECT 1
    FROM public.shift_preferences sp
    WHERE sp.id = ANY(p_ids)
      AND sp.status = 'pending'
      AND sp.preference_type = 'preferred'
      AND sp.start_time IS NOT NULL
      AND sp.end_time   IS NOT NULL
      AND sp.store_id   IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        JOIN public.store_members sm ON sm.member_id = tm.id
        WHERE tm.user_id   = auth.uid()
          AND tm.tenant_id = sp.tenant_id
          AND tm.role IN ('owner', 'manager')
          AND sm.store_id  = sp.store_id
          AND sm.is_manager = true
      )
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required for all targets)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. escape hatch (ON CONFLICT DO UPDATE で pending→tentative 遷移が起きうる)
  PERFORM set_config('app.allow_direct_tentative', '1', true);

  -- 6. set-based: 希望 approved / シフト tentative 生成 / 通知 を一括 (単一文 CTE)。
  WITH targets AS (
    SELECT sp.id, sp.tenant_id, sp.user_id, sp.date, sp.store_id,
           sp.start_time, sp.end_time, sp.note
    FROM public.shift_preferences sp
    WHERE sp.id = ANY(p_ids)
      AND sp.status = 'pending'
      AND sp.preference_type = 'preferred'
      AND sp.start_time IS NOT NULL
      AND sp.end_time   IS NOT NULL
      AND sp.store_id   IS NOT NULL
  ),
  upd_pref AS (
    UPDATE public.shift_preferences sp
    SET status = 'approved'
    FROM targets t WHERE sp.id = t.id
    RETURNING sp.id
  ),
  ins_shifts AS (
    INSERT INTO public.shifts (
      tenant_id, user_id, date, start_time, end_time, status,
      tentative_approved_by, tentative_approved_at, note, store_id, preference_id
    )
    SELECT t.tenant_id, t.user_id, t.date, t.start_time, t.end_time, 'tentative',
           auth.uid(), now(), t.note, t.store_id, t.id
    FROM targets t
    ON CONFLICT (tenant_id, user_id, date, store_id) DO UPDATE
      SET start_time    = EXCLUDED.start_time,
          end_time      = EXCLUDED.end_time,
          preference_id = EXCLUDED.preference_id
      WHERE public.shifts.status IN ('pending', 'tentative', 'modified')
    RETURNING id
  ),
  notif AS (
    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
    SELECT t.tenant_id, t.user_id, 'preference_approved',
           'シフト申請が承認されました', NULL,
           '/shift?tab=preferences&date=' || t.date::text
    FROM targets t
    RETURNING 1
  )
  -- 戻り値は upd_pref (承認した希望数) を正とする。
  -- ON CONFLICT で既存 approved に当たりシフト未更新でも、希望 approved 化は整合
  -- (本承認済みシフトが在る日に二重シフトを作らない・許容)。
  SELECT count(*)::integer, COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_count, v_ids
  FROM upd_pref;

  RETURN QUERY SELECT v_count, v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_preferences(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_preferences(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_preferences(uuid[]) TO authenticated;

-- ============================================================
-- (d-2) reject_preferences(p_ids uuid[]) — 希望一括却下の set-based RPC — P1-5
--   pending のみ却下対象 (対応シフトが存在しない = shifts への DELETE 不要)。
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_preferences(
  p_ids uuid[]
)
RETURNS TABLE(rejected_count integer, rejected_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_ids   uuid[];
BEGIN
  -- 1. auth.uid() NULL チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 入力チェック
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::integer, ARRAY[]::uuid[];
    RETURN;
  END IF;

  -- 3. 対象を行ロック取得。pending のみ却下対象。
  --    ※ TEMP TABLE は使わない (同一 tx で approve→reject 呼出時の 42P07 回避)。
  PERFORM 1
  FROM public.shift_preferences sp
  WHERE sp.id = ANY(p_ids)
    AND sp.status = 'pending'
    AND sp.store_id IS NOT NULL
  FOR UPDATE;

  -- 4. authz: targets 全行が二段ゲートを満たすか。1件でも権限外なら全体 RAISE。
  IF EXISTS (
    SELECT 1
    FROM public.shift_preferences sp
    WHERE sp.id = ANY(p_ids)
      AND sp.status = 'pending'
      AND sp.store_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        JOIN public.store_members sm ON sm.member_id = tm.id
        WHERE tm.user_id   = auth.uid()
          AND tm.tenant_id = sp.tenant_id
          AND tm.role IN ('owner', 'manager')
          AND sm.store_id  = sp.store_id
          AND sm.is_manager = true
      )
  ) THEN
    RAISE EXCEPTION 'permission denied (store manager required for all targets)'
      USING ERRCODE = '42501';
  END IF;

  -- 5. set-based: 希望 rejected / 通知 を一括 (shifts には触れない・単一文 CTE)
  WITH targets AS (
    SELECT sp.id, sp.tenant_id, sp.user_id, sp.date, sp.store_id
    FROM public.shift_preferences sp
    WHERE sp.id = ANY(p_ids)
      AND sp.status = 'pending'
      AND sp.store_id IS NOT NULL
  ),
  upd AS (
    UPDATE public.shift_preferences sp
    SET status = 'rejected'
    FROM targets t WHERE sp.id = t.id
    RETURNING sp.id
  ),
  notif AS (
    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link)
    SELECT t.tenant_id, t.user_id, 'preference_rejected',
           'シフト申請が却下されました', NULL,
           '/shift?tab=preferences'
    FROM targets t
    RETURNING 1
  )
  SELECT count(*)::integer, COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_count, v_ids
  FROM upd;

  RETURN QUERY SELECT v_count, v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_preferences(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_preferences(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reject_preferences(uuid[]) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK 手順
-- ============================================================
-- BEGIN;
-- -- (a) UNIQUE を元 (3列) に戻す。※4列で別店舗複数シフトが既に入っていると失敗しうる。
-- ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_tenant_user_date_store_key;
-- ALTER TABLE public.shifts
--   ADD CONSTRAINT shifts_tenant_id_user_id_date_key UNIQUE (tenant_id, user_id, date);
-- -- (b)(d) 新規 RPC の削除
-- DROP FUNCTION IF EXISTS public.approve_preference(uuid, time, time);
-- DROP FUNCTION IF EXISTS public.revert_preference(uuid);
-- DROP FUNCTION IF EXISTS public.approve_preferences(uuid[]);
-- DROP FUNCTION IF EXISTS public.reject_preferences(uuid[]);
-- -- (c) 改修した既存 RPC は 055 / 054 の該当ブロックを再 apply して復元する
-- --     (revert_shift_to_tentative は 055・reject_shift は 054)。
-- COMMIT;
-- ============================================================

-- ============================================================
-- 検証 SQL (秘書ゲート・read-only / 単一呼び出し BEGIN..ROLLBACK)
--   fixture: tenant 6650e979-1777-44f4-a01b-a1752a37f92c
--     owner  3a881ea3-34a9-421b-aea6-1412980ad541
--     mgr    40a9ecca-6e37-435f-a447-c1c5a87cfef1
--     staff  0b1e5162-270d-45a7-a1db-65e075ff78e9
--     store  bc8e08b5-c736-4012-9f66-3989d3fed5b9
--   ※ RPC 内 auth.uid() は SET request.jwt.claims で擬似化して検証する。
--   ※ 101 未 apply の状態で検証する場合は、BEGIN 直後に本ファイルの DDL を貼り付けてから
--      RPC を呼び、末尾 ROLLBACK で巻き戻す (一時適用検証)。
-- ============================================================
-- #A: UNIQUE 組替の前提 — 4列複合の重複 (0件が apply 条件)
-- SELECT tenant_id, user_id, date, store_id, count(*)
-- FROM public.shifts
-- GROUP BY tenant_id, user_id, date, store_id HAVING count(*) > 1;
--
-- #A-2: store_id IS NULL 行数 (NULL は UNIQUE で重複扱いされない)
-- SELECT count(*) FILTER (WHERE store_id IS NULL) AS null_store, count(*) AS total
-- FROM public.shifts;
--
-- #A-3: 旧UNIQUE制約名 (DROP 対象が想定名か)
-- SELECT conname FROM pg_constraint
-- WHERE conrelid='public.shifts'::regclass AND contype='u';
--
-- #B: get_advisors(security) で新 5 関数 (approve_preference / revert_preference /
--     approve_preferences / reject_preferences と改修 reject_shift / revert_shift_to_tentative)
--     に search_path / anon の WARN が 0 であること。
-- ============================================================
