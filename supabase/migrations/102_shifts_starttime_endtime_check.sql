-- ============================================================
-- 102_shifts_starttime_endtime_check.sql
-- shifts に「開始時刻 ≠ 終了時刻」CHECK 制約を追加する
--   設計書: .company/engineering/docs/2026-06-19-kintai-batch-e-tz-shift-check.md
--   作成日: 2026-06-19  リスクティア: L (DDL + 金額計算源の発生源封鎖)
--
-- 背景 / なぜ:
--   start_time === end_time のシフトは「労働時間 0」を意図しているはずだが、
--   給与/見込み計上ロジックの算出式
--     shiftMins = endMin > startMin ? endMin - startMin : 24*60 - startMin + endMin
--   では start==end のとき endMin>startMin が false に落ち、
--     24*60 - startMin + endMin = 1440 (= 24h)
--   と化けて 1日分の人件費を誤計上する。フロント側ガード(useShift / PayrollCalculation)
--   と二重防御で、発生源そのものを DB CHECK で塞ぐ。
--
-- スコープ (やること / やらないこと):
--   - 追加するのは start_time <> end_time のみ。
--   - 日跨ぎ(end_time < start_time, 例 21:00-05:00)は正当な夜勤として「許容」する。
--     よって start_time < end_time を強制してはならない (= 夜勤を壊さない)。
--
-- 冪等性:
--   制約名 shifts_start_end_distinct が未存在のときだけ追加する DO ブロック。
--   再適用しても二重追加にならない。
--
-- 前提 (適用前に秘書ゲートで read-only 確認 = 本ファイル末尾 検証SQL #A):
--   SELECT count(*) FROM shifts WHERE start_time = end_time;  -- 0 であること
--   (0 でなければ ADD CONSTRAINT が既存行で失敗するため、先にデータ是正が必要)
--
-- Depends on:
--   012(shifts 定義 / start_time,end_time TIME NOT NULL / 15分刻みCHECK)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shifts_start_end_distinct'
      AND conrelid = 'public.shifts'::regclass
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_start_end_distinct
      CHECK (start_time <> end_time);
  END IF;
END
$$;

-- ============================================================
-- 検証SQL (秘書ゲートで実行。本ファイルでは適用しない / コメントのまま):
--
-- #A 適用前提 (read-only):
--   SELECT count(*) AS zero_length_shifts FROM shifts WHERE start_time = end_time;
--   -- => 0 を確認してから ALTER を流す。
--
-- #B 単一呼び BEGIN..ROLLBACK ドライラン (1 呼び出し / COMMIT 禁止):
--   BEGIN;
--     ALTER TABLE public.shifts ADD CONSTRAINT shifts_start_end_distinct CHECK (start_time <> end_time);
--     -- (a) start==end は弾かれる (期待: ERROR 23514)
--     -- (b) 日跨ぎ 21:00-05:00 は通る (期待: 成功)
--   ROLLBACK;
-- ============================================================
