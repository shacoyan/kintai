import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { AttendanceRecord } from '../../types';
import { useToast } from '../../contexts/ToastContext';

interface ClockButtonProps {
  status: 'not_started' | 'working' | 'on_break';
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  todayRecords: AttendanceRecord[];
  activeRecord: AttendanceRecord | null;
}

export function ClockButton({ status, clockIn, clockOut, todayRecords, activeRecord }: ClockButtonProps) {
  const { showToast } = useToast();
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
    } catch (err: any) {
      showToast(err.message || 'エラーが発生しました', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const todayStr = formatInTimeZone(currentTime, 'Asia/Tokyo', 'yyyy-MM-dd');
  const isCarryOver = activeRecord ? activeRecord.date !== todayStr : false;

  const getButtonConfig = () => {
    switch (status) {
      case 'not_started':
        if (todayRecords.some((r) => r.date === todayStr)) {
          return { label: '再出勤', bg: 'bg-green-500 hover:bg-green-600', disabled: false };
        }
        return { label: '出勤', bg: 'bg-green-500 hover:bg-green-600', disabled: false };
      case 'working':
        return { label: isCarryOver ? '退勤（日跨ぎ）' : '退勤', bg: 'bg-red-500 hover:bg-red-600', disabled: false };
      case 'on_break':
        return { label: '休憩中...', bg: 'bg-yellow-400', disabled: true };
    }
  };

  const config = getButtonConfig();
  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-5xl font-bold text-gray-800">{format(currentTime, 'HH:mm')}</div>
      <button
        onClick={handleClick}
        disabled={config.disabled || processing}
        className={`w-48 h-48 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-all ${config.bg} ${config.disabled ? 'cursor-not-allowed opacity-70' : 'active:scale-95'}`}
      >
        {processing ? '処理中...' : config.label}
      </button>

      {activeRecord?.clock_in && (
        <div className="flex gap-6 text-sm text-gray-500">
          <span>出勤: {formatTime(activeRecord.clock_in)}</span>
          {activeRecord.clock_out && <span>退勤: {formatTime(activeRecord.clock_out)}</span>}
        </div>
      )}

      {todayRecords.length > 0 && (
        <div className="w-full max-w-sm mt-2">
          <p className="text-xs text-gray-400 mb-2 text-center">セッション一覧</p>
          <div className="space-y-1">
            {todayRecords.map((record, index) => {
              const isCrossDay = record.date !== todayStr;
              return (
                <div key={record.id} className={`flex items-center justify-between text-sm rounded px-3 py-1.5 ${isCrossDay ? 'bg-amber-50' : 'bg-gray-50'}`}>
                  <span className="text-gray-500">
                    {isCrossDay ? `${record.date}〜` : `${index + 1}回目`}
                  </span>
                  <div className="flex gap-3">
                    <span className="text-gray-700">{formatTime(record.clock_in) || '-'}</span>
                    <span className="text-gray-400">〜</span>
                    <span className="text-gray-700">{formatTime(record.clock_out) || '勤務中'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
