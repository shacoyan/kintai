import { useState, useEffect, useRef } from 'react';
import { differenceInMinutes, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { AttendanceRecord } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Badge, Button, Card } from '../ui';

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
          return {
            label: '再出勤する',
            badgeLabel: '待機中',
            badgeTone: 'neutral' as const,
            withDot: false,
            buttonVariant: 'primary' as const,
            borderColor: 'border-neutral-200 dark:border-neutral-700',
            disabled: false,
          };
        }
        return {
          label: '出勤する',
          badgeLabel: '待機中',
          badgeTone: 'neutral' as const,
          withDot: false,
          buttonVariant: 'primary' as const,
          borderColor: 'border-neutral-200 dark:border-neutral-700',
          disabled: false,
        };
      case 'working':
        return {
          label: isCarryOver ? '退勤する（日跨ぎ）' : '退勤する',
          badgeLabel: isCarryOver ? '日跨ぎ勤務' : '勤務中',
          badgeTone: isCarryOver ? 'warning' as const : 'success' as const,
          withDot: true,
          buttonVariant: 'danger' as const,
          borderColor: isCarryOver ? 'border-warning-500 dark:border-warning-400' : 'border-success-500 dark:border-success-400',
          disabled: false,
        };
      case 'on_break':
        return {
          label: '休憩中…',
          badgeLabel: '休憩中',
          badgeTone: 'warning' as const,
          withDot: true,
          buttonVariant: 'primary' as const,
          borderColor: 'border-warning-400 dark:border-warning-300',
          disabled: true,
        };
    }
  };

  const config = getButtonConfig();
  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;
  const elapsedMin = activeRecord?.clock_in ? differenceInMinutes(currentTime, parseISO(activeRecord.clock_in)) : 0;
  const elapsedH = Math.floor(elapsedMin / 60);
  const elapsedM = elapsedMin % 60;
  const elapsedText = elapsedH > 0 ? `${elapsedH}時間${elapsedM}分` : `${elapsedM}分`;

  return (
    <Card
      padding="md"
      className={`w-full border-l-4 motion-safe:transition-all duration-180 ease-out-expo ${config.borderColor} ${flashGreen ? 'border-l-[6px] bg-success-50/60 dark:bg-success-900/20' : ''}`}
      aria-busy={processing || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Badge tone={config.badgeTone} withDot={config.withDot}>{config.badgeLabel}</Badge>
        <div className="text-kpi-lg font-num tabular-nums text-neutral-900 dark:text-neutral-50 min-w-[8ch] text-right">
          {format(currentTime, 'HH:mm')}
          <span className="ml-1 text-body-sm font-num tabular-nums text-neutral-500 dark:text-neutral-400 align-baseline">
            :{format(currentTime, 'ss')}
          </span>
        </div>
      </div>

      {activeRecord?.clock_in && (
        <div className="mt-3 text-body-sm text-neutral-500 dark:text-neutral-300">
          出勤 <span className="font-num tabular-nums">{formatTime(activeRecord.clock_in)}</span> ・ 経過 <span className="font-num tabular-nums">{elapsedText}</span>
        </div>
      )}

      <div className="mt-4">
        <Button
          variant={config.buttonVariant}
          size="lg"
          fullWidth
          onClick={handleClick}
          disabled={config.disabled || processing}
          aria-label={config.label}
          loading={processing}
        >
          {config.label}
        </Button>
      </div>
    </Card>
  );
}
