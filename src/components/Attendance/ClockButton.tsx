// FILE: components/Attendance/ClockButton.tsx
import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { AttendanceRecord } from '../../types';

interface ClockButtonProps {
  status: 'not_started' | 'working' | 'on_break' | 'finished';
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  todayRecord: AttendanceRecord | null;
}

export function ClockButton({ status, clockIn, clockOut, todayRecord }: ClockButtonProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleClick = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      if (status === 'not_started') {
        await clockIn();
      } else if (status === 'working') {
        await clockOut();
      }
    } finally {
      setProcessing(false);
    }
  };

  const getButtonConfig = () => {
    switch (status) {
      case 'not_started':
        return { label: '出勤', bg: 'bg-green-500 hover:bg-green-600', disabled: false };
      case 'working':
        return { label: '退勤', bg: 'bg-red-500 hover:bg-red-600', disabled: false };
      case 'on_break':
        return { label: '休憩中...', bg: 'bg-yellow-400', disabled: true };
      case 'finished':
        return { label: 'お疲れ様！', bg: 'bg-gray-400', disabled: true };
    }
  };

  const config = getButtonConfig();
  const formatTime = (iso: string | null) => iso ? format(parseISO(iso), 'HH:mm') : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-5xl font-bold text-gray-800">
        {format(currentTime, 'HH:mm')}
      </div>

      <button
        onClick={handleClick}
        disabled={config.disabled || processing}
        className={`w-48 h-48 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-all ${config.bg} ${config.disabled ? 'cursor-not-allowed opacity-70' : 'active:scale-95'}`}
      >
        {config.label}
      </button>

      <div className="flex gap-6 text-sm text-gray-500">
        {todayRecord?.clock_in && (
          <span>出勤: {formatTime(todayRecord.clock_in)}</span>
        )}
        {todayRecord?.clock_out && (
          <span>退勤: {formatTime(todayRecord.clock_out)}</span>
        )}
      </div>
    </div>
  );
}
