import { useState, useEffect, useRef, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { AttendanceRecord } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Spinner } from '../ui/Spinner';

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
  const [flashGreen, setFlashGreen] = useState(false);
  const prevStatusRef = useRef(status);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const TOOLTIP_TEXTS: Record<ClockButtonProps['status'], string> = {
    not_started: '出勤する',
    working: '退勤する',
    on_break: '休憩終了',
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      (prev === 'not_started' && status === 'working') ||
      (prev === 'working' && status === 'not_started')
    ) {
      setFlashGreen(true);
      const t = setTimeout(() => setFlashGreen(false), 600);
      prevStatusRef.current = status;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = status;
  }, [status]);

  const handlePointerDown = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  };

  const handleClick = async () => {
    if (processing) return;
    triggerHaptic();
    setProcessing(true);
    try {
      if (status === 'not_started') {
        await clockIn();
      } else if (status === 'working') {
        await clockOut();
      }
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
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
          return { label: '再出勤', bg: 'bg-success-500 hover:bg-success-600 dark:hover:bg-success-500', disabled: false };
        }
        return { label: '出勤', bg: 'bg-success-500 hover:bg-success-600 dark:hover:bg-success-500', disabled: false };
      case 'working':
        return { label: isCarryOver ? '退勤（日跨ぎ）' : '退勤', bg: 'bg-danger-500 hover:bg-danger-600 dark:hover:bg-danger-500', disabled: false };
      case 'on_break':
        return { label: '休憩中...', bg: 'bg-warning-400', disabled: true };
    }
  };

  const config = getButtonConfig();
  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-5xl md:text-6xl font-bold font-mono text-neutral-800 dark:text-neutral-100 tabular-nums tracking-tight">
        {format(currentTime, 'HH:mm:ss')}
      </div>
      <div className="relative">
        {showTooltip && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 dark:bg-neutral-200 px-4 py-2 text-sm text-white dark:text-neutral-800 shadow-lg z-10">
            {TOOLTIP_TEXTS[status]}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-800 dark:bg-neutral-200 rotate-45"></div>
          </div>
        )}
        <button
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          disabled={config.disabled || processing}
          aria-label={config.label}
          aria-pressed={status !== 'not_started'}
          className={`w-48 h-48 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg motion-safe:transition-colors duration-180 ease-out-expo select-none ${flashGreen ? 'bg-success-400 scale-105' : config.bg} ${config.disabled ? 'cursor-not-allowed opacity-70' : 'active:scale-[0.98]'}`}
        >
          {processing && <Spinner size="sm" inline className="mr-2" />}{config.label}
        </button>
      </div>

      {activeRecord?.clock_in && (
        <div className="flex gap-6 text-sm text-neutral-500 dark:text-neutral-300">
          <span>出勤: {formatTime(activeRecord.clock_in)}</span>
          {activeRecord.clock_out && <span>退勤: {formatTime(activeRecord.clock_out)}</span>}
        </div>
      )}

      {todayRecords.length > 0 && (
        <div className="w-full max-w-sm mt-2">
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-2 text-center">セッション一覧</p>
          <div className="space-y-1">
            {todayRecords.map((record, index) => {
              const isCrossDay = record.date !== todayStr;
              return (
                <div key={record.id} className={`min-h-[44px] flex items-center justify-between text-sm rounded px-3 py-2 ${isCrossDay ? 'bg-warning-50 dark:bg-warning-900/30' : 'bg-neutral-50 dark:bg-neutral-800'}`}>
                  <span className="text-neutral-500 dark:text-neutral-300">
                    {isCrossDay ? `${record.date}〜` : `${index + 1}回目`}
                  </span>
                  <div className="flex gap-3">
                    <span className="text-neutral-700 dark:text-neutral-300">{formatTime(record.clock_in) || '-'}</span>
                    <span className="text-neutral-400 dark:text-neutral-500">〜</span>
                    <span className="text-neutral-700 dark:text-neutral-300">{formatTime(record.clock_out) || '勤務中'}</span>
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
