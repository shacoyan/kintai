import { differenceInMinutes, parseISO } from 'date-fns';
import type { Shift, AttendanceRecord } from '../types';

export interface ShiftMismatch {
  date: string;
  userId: string;
  shiftId: string;
  type: 'absent' | 'late' | 'early_leave' | 'no_record';
  shiftStart: string;
  shiftEnd: string;
  actualStart?: string;
  actualEnd?: string;
  diffMinutes: number;  // how many minutes off
  message: string;
}

const TOLERANCE_MINUTES = 15; // 15分の猶予

export function detectMismatches(
  shifts: Shift[],
  attendance: AttendanceRecord[],
): ShiftMismatch[] {
  const mismatches: ShiftMismatch[] = [];

  // Only check approved shifts
  const approvedShifts = shifts.filter(s => s.status === 'approved');

  for (const shift of approvedShifts) {
    // Find attendance records for this user on this date
    const records = attendance.filter(
      r => r.user_id === shift.user_id && r.date === shift.date
    );

    if (records.length === 0) {
      // No attendance at all for an approved shift
      mismatches.push({
        date: shift.date,
        userId: shift.user_id,
        shiftId: shift.id,
        type: 'no_record',
        shiftStart: shift.start_time,
        shiftEnd: shift.end_time,
        diffMinutes: 0,
        message: 'シフトに対する出勤記録がありません',
      });
      continue;
    }

    // Check the first clock_in against shift start
    const firstRecord = records[0];
    if (firstRecord.clock_in) {
      const clockInTime = parseISO(firstRecord.clock_in);
      // Build expected shift start as Date
      const [sh, sm] = shift.start_time.split(':').map(Number);
      const shiftStartDate = new Date(clockInTime);
      shiftStartDate.setHours(sh, sm, 0, 0);
      // If the date part differs (shift date vs clock_in date), use shift.date
      const shiftDateParts = shift.date.split('-').map(Number);
      shiftStartDate.setFullYear(shiftDateParts[0], shiftDateParts[1] - 1, shiftDateParts[2]);

      const lateMins = differenceInMinutes(clockInTime, shiftStartDate);
      if (lateMins > TOLERANCE_MINUTES) {
        mismatches.push({
          date: shift.date,
          userId: shift.user_id,
          shiftId: shift.id,
          type: 'late',
          shiftStart: shift.start_time,
          shiftEnd: shift.end_time,
          actualStart: firstRecord.clock_in,
          diffMinutes: lateMins,
          message: `${lateMins}分の遅刻`,
        });
      }
    }

    // Check the last clock_out against shift end
    const lastRecord = records[records.length - 1];
    if (lastRecord.clock_out) {
      const clockOutTime = parseISO(lastRecord.clock_out);
      const [eh, em] = shift.end_time.split(':').map(Number);
      const shiftEndDate = new Date(clockOutTime);
      const shiftDateParts = shift.date.split('-').map(Number);
      shiftEndDate.setFullYear(shiftDateParts[0], shiftDateParts[1] - 1, shiftDateParts[2]);
      shiftEndDate.setHours(eh, em, 0, 0);
      // Handle overnight shifts
      if (eh < parseInt(shift.start_time.split(':')[0])) {
        shiftEndDate.setDate(shiftEndDate.getDate() + 1);
      }

      const earlyMins = differenceInMinutes(shiftEndDate, clockOutTime);
      if (earlyMins > TOLERANCE_MINUTES) {
        mismatches.push({
          date: shift.date,
          userId: shift.user_id,
          shiftId: shift.id,
          type: 'early_leave',
          shiftStart: shift.start_time,
          shiftEnd: shift.end_time,
          actualEnd: lastRecord.clock_out,
          diffMinutes: earlyMins,
          message: `${earlyMins}分の早退`,
        });
      }
    } else if (!lastRecord.clock_out && lastRecord.clock_in) {
      // Still clocked in (no clock_out yet) - skip, not an error yet
    }
  }

  return mismatches;
}
