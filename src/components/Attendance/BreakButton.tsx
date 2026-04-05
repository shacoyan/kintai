// FILE: components/Attendance/BreakButton.tsx
import { format, parseISO } from 'date-fns';
import { AttendanceRecord } from '../../types';

interface BreakButtonProps {
  status: 'not_started' | 'working' | 'on_break' | 'finished';
  breakStart: () => Promise<void>;
  breakEnd: () => Promise<void>;
  todayRecord: AttendanceRecord | null;
}

export function BreakButton({ status, breakStart, breakEnd, todayRecord }: BreakButtonProps) {
  if (status !== 'working' && status !== 'on_break') {
    return null;
  }

  const formatTime = (iso: string | null) => iso ? format(parseISO(iso), 'HH:mm') : null;

  return (
    <div className="flex flex-col items-center gap-2">
      {status === 'working' && (
        <button
          onClick={breakStart}
          className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-8 rounded-lg transition-colors active:scale-95"
        >
          休憩開始
        </button>
      )}

      {status === 'on_break' && (
        <>
          <button
            onClick={breakEnd}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-8 rounded-lg transition-colors active:scale-95"
          >
            休憩終了
          </button>
          {todayRecord?.break_start && (
            <p className="text-sm text-gray-500">
              休憩開始: {formatTime(todayRecord.break_start)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
