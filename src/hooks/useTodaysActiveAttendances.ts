import { useEffect, useMemo, useState } from 'react';
import { subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from '../lib/supabase';
import type { AttendanceRecord, TenantMember } from '../types';

export interface TodaysActiveAttendance {
  user_id: string;
  status: 'working' | 'break' | 'finished' | 'absent';
  /** 出勤打刻 or 休憩開始 or 退勤打刻 の HH:mm 文字列 */
  since: string | null;
  record: AttendanceRecord | null;
}

interface UseTodaysActiveAttendancesOptions {
  tenantId: string;
  members: TenantMember[];
  /** owner / manager 以外なら fetch しない */
  enabled: boolean;
}

interface UseTodaysActiveAttendancesResult {
  byUserId: Map<string, TodaysActiveAttendance>;
  loading: boolean;
  error: Error | null;
  workingCount: number;
}

/**
 * テナント全員の "今日の打刻状況" を 1 回の select で取得し
 * user_id -> status マッピングを返す。
 *
 * status 判定:
 *   - clock_in IS NOT NULL かつ clock_out IS NULL かつ breaks に end_time NULL のものあり → 'break'
 *   - clock_in IS NOT NULL かつ clock_out IS NULL → 'working'
 *   - clock_in IS NOT NULL かつ clock_out IS NOT NULL → 'finished'
 *   - record なし → 'absent'
 */
export function useTodaysActiveAttendances({
  tenantId,
  members,
  enabled,
}: UseTodaysActiveAttendancesOptions): UseTodaysActiveAttendancesResult {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const now = new Date();
    // TZ: 非JST環境でも当日判定がアプリ他箇所(useAttendance 等)と一致するよう
    // Asia/Tokyo で日付文字列を生成する。
    const todayStr = formatInTimeZone(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    // 退勤忘れ孤児対策: clock_out IS NULL の行は退勤打刻漏れがあると無限に溜まり、
    // 取得件数が線形劣化する。日付下限(数日)を入れて古い孤児を除外しつつ、
    // 深夜跨ぎの本当の勤務中(前日 date の未退勤)は隠さない余裕を持たせる。
    // さらに .limit() で上限を設けて最悪ケースの取得量を頭打ちにする。
    const orphanFloor = formatInTimeZone(subDays(now, 3), 'Asia/Tokyo', 'yyyy-MM-dd');
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: e } = await supabase
          .from('attendance_records')
          .select('*, breaks(*)')
          .eq('tenant_id', tenantId)
          .gte('date', orphanFloor)
          .or(`date.eq.${todayStr},clock_out.is.null`)
          .order('clock_in', { ascending: true })
          .limit(500);

        if (e) throw new Error(e.message);
        if (!cancelled) setRecords((data as AttendanceRecord[]) ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, tenantId]);

  const byUserId = useMemo(() => {
    const map = new Map<string, TodaysActiveAttendance>();
    for (const member of members) {
      map.set(member.user_id, {
        user_id: member.user_id,
        status: 'absent',
        since: null,
        record: null,
      });
    }

    const priority = (status: TodaysActiveAttendance['status']) =>
      status === 'working' || status === 'break' ? 3 : status === 'finished' ? 2 : 1;

    for (const record of records) {
      const breaks = record.breaks ?? [];
      const activeBreak = breaks.find((b) => b.end_time === null);
      let status: 'working' | 'break' | 'finished';
      let since: string | null;

      if (record.clock_out === null) {
        if (activeBreak) {
          status = 'break';
          since = activeBreak.start_time;
        } else {
          status = 'working';
          since = record.clock_in;
        }
      } else {
        status = 'finished';
        since = record.clock_out;
      }

      const existing = map.get(record.user_id);
      if (!existing || priority(status) >= priority(existing.status)) {
        map.set(record.user_id, {
          user_id: record.user_id,
          status,
          since: since ? since.slice(11, 16) : null,
          record,
        });
      }
    }

    return map;
  }, [records, members]);

  const workingCount = useMemo(
    () =>
      Array.from(byUserId.values()).filter(
        (attendance) => attendance.status === 'working' || attendance.status === 'break',
      ).length,
    [byUserId],
  );

  return { byUserId, loading, error, workingCount };
}
