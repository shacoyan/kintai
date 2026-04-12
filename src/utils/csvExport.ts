import { parseISO, differenceInMinutes } from 'date-fns';
import type { AttendanceRecord, TenantMember } from '../types';
import { getNightMinutesInRange } from './nightShift';

interface CsvRow {
  date: string;
  name: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  workTime: string;
  nightTime: string;
  rateLabel: string;
  payment: number;
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtClock(iso: string): string {
  const d = parseISO(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function generatePayrollCsv(
  records: AttendanceRecord[],
  members: TenantMember[]
): string {
  const memberMap = new Map(members.map(m => [m.user_id, m]));
  const rows: CsvRow[] = [];

  for (const r of records) {
    if (!r.clock_in) continue;
    const member = memberMap.get(r.user_id);
    if (!member) continue;

    const breakMins = (r.breaks || []).reduce((sum, b) => {
      if (b.start_time && b.end_time) {
        return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
      }
      return sum;
    }, 0);

    let workMins = r.total_work_minutes;
    if (workMins == null && r.clock_in && r.clock_out) {
      const gross = differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in));
      workMins = Math.max(0, gross - breakMins);
    }
    if (workMins == null || workMins <= 0) continue;

    let nightMins = 0;
    if (member.night_shift_enabled && r.clock_in && r.clock_out) {
      nightMins = getNightMinutesInRange(parseISO(r.clock_in), parseISO(r.clock_out));
      // 休憩中の深夜分を差し引く
      for (const b of (r.breaks || [])) {
        if (b.start_time && b.end_time) {
          nightMins -= getNightMinutesInRange(parseISO(b.start_time), parseISO(b.end_time));
        }
      }
      nightMins = Math.max(0, nightMins);
    }

    const normalMins = workMins - nightMins;
    const payType = member.pay_type ?? 'hourly';
    const rate = member.hourly_rate ?? 0;
    let payment: number;
    let rateLabel: string;

    if (payType === 'monthly') {
      payment = 0; // 月給はレコードごとには計算しない
      rateLabel = `${(member.monthly_salary ?? 0).toLocaleString()}円/月`;
    } else {
      payment = Math.ceil((normalMins / 60) * rate + (nightMins / 60) * rate * 1.25);
      rateLabel = `${rate.toLocaleString()}円/時`;
    }

    rows.push({
      date: r.date,
      name: member.display_name,
      clockIn: fmtClock(r.clock_in),
      clockOut: r.clock_out ? fmtClock(r.clock_out) : '',
      breakMinutes: breakMins,
      workTime: fmtTime(workMins),
      nightTime: fmtTime(nightMins),
      rateLabel,
      payment,
    });
  }

  // CSV値をダブルクォートで囲む（内部のダブルクォートはエスケープ）
  const csvEscape = (val: string | number): string => {
    const s = String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };

  // ヘッダー
  const header = ['日付', '名前', '出勤', '退勤', '休憩(分)', '労働時間', '深夜時間', '時給/月給', '支給額'].map(csvEscape).join(',');
  const lines = rows.map(r =>
    [r.date, r.name, r.clockIn, r.clockOut, r.breakMinutes, r.workTime, r.nightTime, r.rateLabel, r.payment].map(csvEscape).join(',')
  );

  // 月給スタッフの合計行を追加
  const monthlyMembers = members.filter(m => (m.pay_type ?? 'hourly') === 'monthly');
  for (const m of monthlyMembers) {
    const emptyCols = Array(8).fill('').map(csvEscape).join(',');
    lines.push(`${emptyCols},${csvEscape(`月給: ${m.display_name} ¥${(m.monthly_salary ?? 0).toLocaleString()}`)}`);
  }

  // UTF-8 BOM
  const BOM = '\uFEFF';
  return BOM + header + '\n' + lines.join('\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
