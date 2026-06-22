-- ============================================================
-- 103_cancel_shift_tentative_preference_sync.sql
-- cancel_shift_tentative (仮承認取消 / shifts: tentative→pending) に
-- リンク希望(shift_preferences)の approved→pending 同期を追加する
--   設計書: .company/engineering/docs/2026-06-22-kintai-cancel-tentative-preference-sync.md
--   作成日: 2026-06-22  リスクティア: L (SECURITY DEFINER RPC改修 + shift_preferences書込 + 認可)
--
-- 背景 / なぜ:
--   二段承認モデル: 希望(shift_preferences)approved ⇔ シフト(shifts)tentative ⇔ UI「仮承認」。
--   cancel_shift_tentative(053・以降未改修)は仮承認シフトを tentative→pending(申請中)へ
--   差し戻すが、リンク先 shift_preferences に一切触れない。結果 shifts.status='pending' でも
--   shift_preferences.status='approved' が取り残され、希望タブ等で「仮承認(承認済)」と誤表示
--   される(本番実害=ソマ氏 7/26、preferred / shift=pending / pref=approved の1件が現存)。
--   migration 101「差し戻しバグ根治」は reject_shift(→pref rejected)/
--   revert_shift_to_tentative(→pref approved復元)/ revert_preference(希望→pending時にshift削除)
--   の3経路は希望同期したが、cancel_shift_tentative の tentative→pending 経路だけ取りこぼした。
--
-- 設計(最小スコープ):
--   053 の本体(認可・状態チェック・shifts UPDATE)を完全維持し、shifts を pending へ戻した
--   直後に「リンク希望を approved→pending へ同期」する 1 ブロックのみ追加(revert_preference /
--   reject_shift の preference 同期と対称)。
--
-- 安全性の根拠(実DBで裏取り済 2026-06-22 / project=kintai zjjbfffhbobwwxyvdszl):
--   - escape hatch 不要: 053 本体の shifts:tentative→pending は 054 トリガ
--     (trg_shifts_enforce_approval_order)の「pending 遷移は通常UPDATE許可」分岐で通る
--     (現行RPCが escape hatch 無しで稼働している実績)。新規追加するのは shift_preferences の
--     approved→pending UPDATE で、shift_preferences には status 遷移ガードトリガが存在せず、
--     035 の enforce_unavailable_auto_approve は preference_type='unavailable' のみ作用する。
--     preference_id でリンクされた本番 shift は 全件 preference_type='preferred'(unavailable=0件)
--     のため、035 が pending を approved へ巻き戻す経路は存在しない。revert_preference(101)が
--     同じ pref→pending を escape hatch 無しで実現している前例とも一致。
--   - preference_id IS NULL(手動追加の仮承認シフト=本番7件)は希望が無いので同期しない(IFガード)。
--   - status='approved' のときのみ pending 化(冪等:既に pending/rejected には触らない)。
--   - 認可は 053 既存を維持。101 の二段ゲート(store_members.is_manager JOIN)への harmonize は
--     「差し戻し可能者の集合」を変えてしまう(is_store_manager は緩い判定)ため本fix対象外(別フォロー)。
-- ============================================================

BEGIN;

-- ============================================================
-- RPC: cancel_shift_tentative (053 を CREATE OR REPLACE・シグネチャ不変)
--   差分は手順6の後ろに preference 同期ブロック(手順7)を1つ足すのみ。
--   既存の 1〜6(auth/行ロック/存在/owner-manager/店舗ガード/状態/shifts UPDATE)は完全保持。
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_shift_tentative(
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

  -- 4. 権限チェック: owner/managerのみ
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = v_shift.tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'permission denied: only owner/manager can cancel tentative approval';
  END IF;

  -- 4a. 店舗ガード: 当該店舗のマネージャー権限
  IF NOT public.is_store_manager(v_shift.tenant_id, v_shift.store_id) THEN
    RAISE EXCEPTION 'permission denied: not a manager of store %', v_shift.store_id;
  END IF;

  -- 5. 状態チェック: tentativeのみキャンセル可能
  IF v_shift.status != 'tentative' THEN
    RAISE EXCEPTION 'cannot cancel: not in tentative state';
  END IF;

  -- 6. 仮承認取り消し → pendingに戻す
  --    (054 トリガは tentative→pending を通常UPDATEとして許容するため escape hatch 不要)
  UPDATE public.shifts
  SET status = 'pending',
      tentative_approved_by = NULL,
      tentative_approved_at = NULL
  WHERE id = p_shift_id
  RETURNING * INTO v_result;

  -- 7. リンク希望(shift_preferences)を approved→pending へ同期 (101 取りこぼし根治)。
  --    revert_preference / reject_shift の preference 同期と対称。
  --    - preference_id IS NULL(手動追加の仮承認シフト)は希望が無いのでスキップ。
  --    - status='approved' のときのみ pending 化(冪等:既に pending/rejected は触らない)。
  --    - 035 の unavailable auto-approve トリガは preference_type='unavailable' のみ作用するため
  --      preferred 由来(本番リンクは全件 preferred)の approved→pending は阻害されない。
  --      shift_preferences には status 遷移ガードが無いため escape hatch も不要。
  IF v_shift.preference_id IS NOT NULL THEN
    UPDATE public.shift_preferences
    SET status = 'pending'
    WHERE id = v_shift.preference_id
      AND status = 'approved';
  END IF;

  -- 8. 結果返却(shifts 行。通知は呼出側 useShift / ShiftPage が担当)
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_shift_tentative(uuid) TO authenticated;

COMMIT;

-- ============================================================
-- ロールバック(053 の本体を再 apply = preference 同期ブロックを除いた版を CREATE OR REPLACE):
--   下記設計書末尾 rollbackSql、または supabase/migrations/053_shifts_tentative_approval.sql の
--   cancel_shift_tentative 定義(セクション9)を CREATE OR REPLACE で再適用する。
-- ============================================================
-- 検証(本番 BEGIN..ROLLBACK・request.jwt.claims 擬似化)は設計書 verificationSql を参照。
