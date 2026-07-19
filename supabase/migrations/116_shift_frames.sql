-- ============================================================
-- 116_shift_frames.sql
-- 店舗×曜日のシフト枠テンプレート（shift_frames）+ 特定日上書き
-- （shift_frame_overrides）+ shifts.frame_id リンク + 割当 RPC
--   設計書: .company/engineering/docs/2026-07-20-kintai-shift-frames.md
--   作成日: 2026-07-20  リスクティア: L
--
-- 背景 / なぜ:
--   店舗×曜日の時間枠テンプレートを定義し、スタッフの希望シフト
--   （shift_preferences）を枠ごとに候補表示してすり合わせ当てはめる方式の
--   シフト調整を可能にする（オーナー要件確定 2026-07-20）。
--
-- 設計の柱（新しい状態機械を作らない）:
--   - 割当 = 既存2段階承認の「仮承認」を流用する。101 の approve_preference を
--     frame の実効時刻を override として呼ぶラッパ RPC assign_preference_to_frame
--     で実現し、生成された tentative shift に frame_id を刻む。本承認は既存
--     approve_shift_final フローのまま一切変更しない。
--   - shifts.frame_id は 096 の preference_id と同型の additive 列
--     （nullable / FK ON DELETE SET NULL）。既存行・既存導線に影響ゼロ。
--   - 充足カウントは frame_id リンクされた shifts の明示割当数のみ
--     （時刻一致推測をしない。096 で学んだ「値の一致依存は事故る」原則の踏襲）。
--
-- 冪等性:
--   全 DDL は IF NOT EXISTS / DO ブロック（pg_constraint 存在チェック）で保護。
--   本ファイルを 2 回適用してもエラーにならない。
--
-- ★注意: 本ファイルのどこにも（コメント内含む）行頭 BEGIN;/COMMIT; を書かない
--   （prod-gate の dry-run ラップ BEGIN..ROLLBACK が破られるため）。
--   plpgsql の DO $$ BEGIN ... END $$; / 関数本体の BEGIN は可
--   （セミコロン付き単独行として現れないため）。
--
-- Depends on:
--   012 (shifts 定義・15分刻みCHECK) / 015 (stores/store_members)
--   016 (shift_preferences) / 096 (additive列+FK+部分索引の雛形)
--   101 (approve_preference・認可述語step5) / 102 (start<>end 日跨ぎ許容)
--   107/108 (is_tenant_managerial=owner/admin/manager)
-- ============================================================

-- =========================================================================
-- 0. 共通トリガ関数 tg_touch_updated_at（updated_at 自動更新）
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================================
-- 1. shift_frames（枠テンプレ + 単発枠）
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.shift_frames (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  day_of_week     int,
  date            date,
  name            text NOT NULL,
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  required_count  int NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_frames_day_or_date_xor
    CHECK ((day_of_week IS NULL) <> (date IS NULL)),
  CONSTRAINT shift_frames_day_of_week_range
    CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
  CONSTRAINT shift_frames_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT shift_frames_required_count_range
    CHECK (required_count BETWEEN 1 AND 50),
  CONSTRAINT shift_frames_start_time_quarter
    CHECK (EXTRACT(MINUTE FROM start_time)::int % 15 = 0 AND EXTRACT(SECOND FROM start_time)::int = 0),
  CONSTRAINT shift_frames_end_time_quarter
    CHECK (EXTRACT(MINUTE FROM end_time)::int % 15 = 0 AND EXTRACT(SECOND FROM end_time)::int = 0),
  CONSTRAINT shift_frames_start_end_distinct
    CHECK (start_time <> end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_frames_weekly_unique
  ON public.shift_frames (tenant_id, store_id, day_of_week, name)
  WHERE day_of_week IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shift_frames_oneoff_unique
  ON public.shift_frames (tenant_id, store_id, date, name)
  WHERE date IS NOT NULL;

DROP TRIGGER IF EXISTS trg_shift_frames_touch_updated_at ON public.shift_frames;
CREATE TRIGGER trg_shift_frames_touch_updated_at
  BEFORE UPDATE ON public.shift_frames
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.shift_frames ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.shift_frames IS
  'シフト枠テンプレート。店舗×曜日の毎週テンプレ（day_of_week NOT NULL）または特定日のみの単発枠（date NOT NULL）を XOR で表現する。要件④: 枠は店舗ごと（テナント共通枠は無い）。';

-- =========================================================================
-- 2. shift_frame_overrides（毎週テンプレの特定日上書き: cancel/modify）
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.shift_frame_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  frame_id        uuid NOT NULL REFERENCES public.shift_frames(id) ON DELETE CASCADE,
  date            date NOT NULL,
  kind            text NOT NULL,
  name            text,
  start_time      time,
  end_time        time,
  required_count  int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_frame_overrides_kind_check
    CHECK (kind IN ('cancel', 'modify')),
  CONSTRAINT shift_frame_overrides_kind_fields_check
    CHECK (
      (kind = 'cancel' AND name IS NULL AND start_time IS NULL AND end_time IS NULL AND required_count IS NULL)
      OR
      (kind = 'modify' AND name IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND required_count IS NOT NULL)
    ),
  CONSTRAINT shift_frame_overrides_start_time_quarter
    CHECK (start_time IS NULL OR (EXTRACT(MINUTE FROM start_time)::int % 15 = 0 AND EXTRACT(SECOND FROM start_time)::int = 0)),
  CONSTRAINT shift_frame_overrides_end_time_quarter
    CHECK (end_time IS NULL OR (EXTRACT(MINUTE FROM end_time)::int % 15 = 0 AND EXTRACT(SECOND FROM end_time)::int = 0)),
  CONSTRAINT shift_frame_overrides_start_end_distinct
    CHECK (start_time IS NULL OR end_time IS NULL OR start_time <> end_time),
  CONSTRAINT shift_frame_overrides_required_count_range
    CHECK (required_count IS NULL OR required_count BETWEEN 1 AND 50)
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_frame_overrides_frame_date_unique
  ON public.shift_frame_overrides (frame_id, date);

CREATE INDEX IF NOT EXISTS idx_shift_frame_overrides_tenant_date
  ON public.shift_frame_overrides (tenant_id, date);

DROP TRIGGER IF EXISTS trg_shift_frame_overrides_touch_updated_at ON public.shift_frame_overrides;
CREATE TRIGGER trg_shift_frame_overrides_touch_updated_at
  BEFORE UPDATE ON public.shift_frame_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.shift_frame_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.shift_frame_overrides IS
  '毎週テンプレ枠（shift_frames.day_of_week NOT NULL）の特定日のみの上書き。kind=cancel はその日だけ休止、kind=modify は名前/時刻/必要人数を丸ごと差替（NULL 継承なし）。単発枠（date NOT NULL）への上書きは禁止（RLS WITH CHECK / 認可述語で強制）。';

-- =========================================================================
-- 3. shifts.frame_id（additive・096 と同型）
-- =========================================================================
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS frame_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shifts'::regclass
      AND conname = 'shifts_frame_id_fkey'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_frame_id_fkey
      FOREIGN KEY (frame_id)
      REFERENCES public.shift_frames(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_frame_id
  ON public.shifts (frame_id)
  WHERE frame_id IS NOT NULL;

-- =========================================================================
-- 4. 整合性トリガ tg_shifts_frame_consistency（shifts）
--    NEW.frame_id が NULL 以外のとき、tenant/store/曜日(単発は date) の全一致を
--    発生源で封鎖する（UI ガードに依存しない）。cancel override 中の枠への割当
--    ブロックは業務判断のため RPC/UI 層の責務とし、トリガには入れない。
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_shifts_frame_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.frame_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.shift_frames f
    WHERE f.id = NEW.frame_id
      AND f.tenant_id = NEW.tenant_id
      AND f.store_id = NEW.store_id
      AND (
        (f.day_of_week IS NOT NULL AND f.day_of_week = EXTRACT(DOW FROM NEW.date)::int)
        OR (f.date IS NOT NULL AND f.date = NEW.date)
      )
  ) THEN
    RAISE EXCEPTION 'shift frame % does not match tenant/store/day for shift (tenant=%, store=%, date=%)',
      NEW.frame_id, NEW.tenant_id, NEW.store_id, NEW.date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shifts_frame_consistency ON public.shifts;
CREATE TRIGGER trg_shifts_frame_consistency
  BEFORE INSERT OR UPDATE OF frame_id ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.tg_shifts_frame_consistency();

-- =========================================================================
-- 5. RLS: shift_frames（4操作 横串）
--    managerial = owner/admin/manager（107 で admin=managerial 確定済。
--    presets の owner/manager 止まりの非対称をここでは作らない）。
--    SELECT は全テナントメンバー閲覧可（スタッフも枠と充足を見られる）。
-- =========================================================================
DROP POLICY IF EXISTS shift_frames_select ON public.shift_frames;
CREATE POLICY shift_frames_select ON public.shift_frames
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

DROP POLICY IF EXISTS shift_frames_insert ON public.shift_frames;
CREATE POLICY shift_frames_insert ON public.shift_frames
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frames.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = shift_frames.store_id
        AND s.tenant_id = shift_frames.tenant_id
    )
  );

DROP POLICY IF EXISTS shift_frames_update ON public.shift_frames;
CREATE POLICY shift_frames_update ON public.shift_frames
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frames.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frames.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = shift_frames.store_id
        AND s.tenant_id = shift_frames.tenant_id
    )
  );

DROP POLICY IF EXISTS shift_frames_delete ON public.shift_frames;
CREATE POLICY shift_frames_delete ON public.shift_frames
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frames.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
  );

-- =========================================================================
-- 6. RLS: shift_frame_overrides（4操作 横串）
--    INSERT/UPDATE の WITH CHECK は「対象フレームのテナント一致 かつ
--    毎週テンプレ枠（day_of_week NOT NULL）である かつ override.date の曜日 =
--    frame.day_of_week」を強制する（単発枠への上書き禁止・曜日整合を DB で強制）。
-- =========================================================================
DROP POLICY IF EXISTS shift_frame_overrides_select ON public.shift_frame_overrides;
CREATE POLICY shift_frame_overrides_select ON public.shift_frame_overrides
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_my_tenant_ids()));

DROP POLICY IF EXISTS shift_frame_overrides_insert ON public.shift_frame_overrides;
CREATE POLICY shift_frame_overrides_insert ON public.shift_frame_overrides
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frame_overrides.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM public.shift_frames f
      WHERE f.id = shift_frame_overrides.frame_id
        AND f.tenant_id = shift_frame_overrides.tenant_id
        AND f.day_of_week IS NOT NULL
        AND f.day_of_week = EXTRACT(DOW FROM shift_frame_overrides.date)::int
    )
  );

DROP POLICY IF EXISTS shift_frame_overrides_update ON public.shift_frame_overrides;
CREATE POLICY shift_frame_overrides_update ON public.shift_frame_overrides
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frame_overrides.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frame_overrides.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM public.shift_frames f
      WHERE f.id = shift_frame_overrides.frame_id
        AND f.tenant_id = shift_frame_overrides.tenant_id
        AND f.day_of_week IS NOT NULL
        AND f.day_of_week = EXTRACT(DOW FROM shift_frame_overrides.date)::int
    )
  );

DROP POLICY IF EXISTS shift_frame_overrides_delete ON public.shift_frame_overrides;
CREATE POLICY shift_frame_overrides_delete ON public.shift_frame_overrides
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = shift_frame_overrides.tenant_id
        AND tm.user_id = ( SELECT auth.uid() )
        AND tm.role IN ('owner', 'admin', 'manager')
    )
  );

-- =========================================================================
-- 7. RPC assign_preference_to_frame
--    希望を枠へ割り当てる。認可 → frame検証 → 実効時刻解決 → approve_preference
--    委譲 → frame_id 付与、の順（認可前にデータ由来の分岐エラーを漏らさない）。
-- =========================================================================
CREATE OR REPLACE FUNCTION public.assign_preference_to_frame(
  p_preference_id uuid,
  p_frame_id uuid
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref    public.shift_preferences%ROWTYPE;
  v_frame   public.shift_frames%ROWTYPE;
  v_override public.shift_frame_overrides%ROWTYPE;
  v_start   time;
  v_end     time;
  v_shift   public.shifts%ROWTYPE;
BEGIN
  -- 1. auth.uid() NULL チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid is null';
  END IF;

  -- 2. 希望取得（存在チェックのみ・ロックは approve_preference 側に任せる）
  SELECT * INTO v_pref
  FROM public.shift_preferences
  WHERE id = p_preference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift preference not found: %', p_preference_id;
  END IF;
  IF v_pref.store_id IS NULL THEN
    RAISE EXCEPTION 'shift preference has no store_id: %', p_preference_id;
  END IF;

  -- 3. 早期認可ゲート = 101 step5 と同一述語（先に検証すると認可漏れ確認前に
  --    データ由来のエラーが漏れるため、この位置で必ず実施する）
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

  -- 4. frame 取得 + 検証
  SELECT * INTO v_frame
  FROM public.shift_frames
  WHERE id = p_frame_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift frame not found: %', p_frame_id;
  END IF;
  IF NOT v_frame.is_active THEN
    RAISE EXCEPTION 'shift frame is not active: %', p_frame_id;
  END IF;
  IF v_frame.tenant_id <> v_pref.tenant_id THEN
    RAISE EXCEPTION 'shift frame tenant mismatch (frame=%, preference=%)', v_frame.tenant_id, v_pref.tenant_id;
  END IF;
  IF v_frame.store_id <> v_pref.store_id THEN
    RAISE EXCEPTION 'shift frame store mismatch (frame=%, preference=%)', v_frame.store_id, v_pref.store_id;
  END IF;
  IF v_frame.day_of_week IS NOT NULL THEN
    IF v_frame.day_of_week <> EXTRACT(DOW FROM v_pref.date)::int THEN
      RAISE EXCEPTION 'shift frame day_of_week mismatch (frame=%, preference date=%)', v_frame.day_of_week, v_pref.date;
    END IF;
  ELSE
    IF v_frame.date <> v_pref.date THEN
      RAISE EXCEPTION 'shift frame date mismatch (frame=%, preference date=%)', v_frame.date, v_pref.date;
    END IF;
  END IF;

  -- 5. 実効時刻の解決: override(kind=cancel→休止/kind=modify→override時刻) or テンプレ時刻
  SELECT * INTO v_override
  FROM public.shift_frame_overrides
  WHERE frame_id = p_frame_id
    AND date = v_pref.date;
  IF FOUND AND v_override.kind = 'cancel' THEN
    RAISE EXCEPTION 'shift frame is cancelled for this date (frame=%, date=%)', p_frame_id, v_pref.date;
  ELSIF FOUND AND v_override.kind = 'modify' THEN
    v_start := v_override.start_time;
    v_end   := v_override.end_time;
  ELSE
    v_start := v_frame.start_time;
    v_end   := v_frame.end_time;
  END IF;

  -- 6. 希望 approved 化 + tentative shift 生成 + 通知は 101 に完全委譲（二重実装しない）
  v_shift := public.approve_preference(p_preference_id, v_start, v_end);
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'preference could not be approved into a shift (already unavailable/approved?): %', p_preference_id;
  END IF;

  -- 7. 生成された tentative shift に frame_id を刻む（4 の整合性トリガが最終防衛）
  UPDATE public.shifts
  SET frame_id = p_frame_id
  WHERE id = v_shift.id
  RETURNING * INTO v_shift;

  -- 8. RETURN
  RETURN v_shift;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_preference_to_frame(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_preference_to_frame(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.assign_preference_to_frame(uuid, uuid) TO authenticated;

-- ============================================================
-- ROLLBACK SQL（116 で追加した全オブジェクトを削除。手動実行）
-- ============================================================
--   DROP FUNCTION IF EXISTS public.assign_preference_to_frame(uuid, uuid);
--   DROP TRIGGER IF EXISTS trg_shifts_frame_consistency ON public.shifts;
--   DROP FUNCTION IF EXISTS public.tg_shifts_frame_consistency();
--   DROP INDEX IF EXISTS public.idx_shifts_frame_id;
--   ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_frame_id_fkey;
--   ALTER TABLE public.shifts DROP COLUMN IF EXISTS frame_id;
--   DROP TABLE IF EXISTS public.shift_frame_overrides;
--   DROP TABLE IF EXISTS public.shift_frames;
--   -- tg_touch_updated_at は他 migration が使わない前提でのみ DROP 可（本 Loop 内では新規消費なし）
--   -- DROP FUNCTION IF EXISTS public.tg_touch_updated_at();
--
-- ============================================================
-- 適用後 検証 SQL（本番で実行・全件 PASS が承認条件。read-only / 無汚染）
-- ============================================================
--   -- 0. 新規オブジェクトの存在確認
--   -- SELECT table_name FROM information_schema.tables
--   --   WHERE table_schema='public' AND table_name IN ('shift_frames','shift_frame_overrides');
--   -- SELECT column_name FROM information_schema.columns
--   --   WHERE table_schema='public' AND table_name='shifts' AND column_name='frame_id';
--   --   -- 期待: frame_id
--   -- SELECT policyname FROM pg_policies
--   --   WHERE schemaname='public' AND tablename IN ('shift_frames','shift_frame_overrides')
--   --   ORDER BY tablename, policyname;
--   --   -- 期待: 両テーブルとも select/insert/update/delete の4本ずつ = 計8本
--   --
--   -- 1. 適用直後は shift_frames / shift_frame_overrides ともに 0 件（新機能・初期データなし）
--   -- SELECT count(*) FROM public.shift_frames;         -- 期待: 0
--   -- SELECT count(*) FROM public.shift_frame_overrides; -- 期待: 0
--   --
--   -- 2. 既存 shifts の frame_id は全件 NULL（バックフィルなし）
--   -- SELECT count(*) FROM public.shifts WHERE frame_id IS NOT NULL; -- 期待: 0
--   --
--   -- 3. 既存 approve_preference の定義が不変であること
--   -- SELECT pg_get_functiondef('public.approve_preference(uuid,time,time)'::regprocedure);
