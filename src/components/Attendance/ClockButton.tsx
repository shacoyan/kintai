import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { differenceInMinutes, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { AttendanceRecord } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { useNow } from '../../hooks/useNow';
import { Badge, Button } from '../ui';

interface ClockButtonProps {
  status: 'not_started' | 'working' | 'on_break';
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  todayRecords: AttendanceRecord[];
  activeRecord: AttendanceRecord | null;
  children?: ReactNode;
}

export function ClockButton({ status, clockIn, clockOut, todayRecords, activeRecord, children }: ClockButtonProps) {
  const { showToast } = useToast();
  const currentTime = useNow(1000);
  const [processing, setProcessing] = useState(false);
  // TRANS-1 (Loop9): status 切替直後 300ms だけ animation を pause し、
  // border-left-color の transition を確実に発火させるためのフラグ。
  const [isTransitioning, setIsTransitioning] = useState(false);
  const badgeWrapperRef = useRef<HTMLSpanElement | null>(null);
  const prevStatusKeyRef = useRef<string>('');

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
            buttonClassName: '!bg-blue-600 hover:!bg-blue-700 !text-white',
            borderColor: 'border-l-stone-200 dark:border-l-stone-700',
            breathClass: '',
            disabled: false,
          };
        }
        return {
          label: '出勤する',
          badgeLabel: '待機中',
          badgeTone: 'neutral' as const,
          withDot: false,
          buttonVariant: 'primary' as const,
          buttonClassName: '!bg-blue-600 hover:!bg-blue-700 !text-white',
          borderColor: 'border-l-stone-200 dark:border-l-stone-700',
          breathClass: '',
          disabled: false,
        };
      case 'working':
        return {
          label: isCarryOver ? '退勤する（日跨ぎ）' : '退勤する',
          badgeLabel: isCarryOver ? '日跨ぎ勤務' : '勤務中',
          badgeTone: isCarryOver ? 'warning' as const : 'success' as const,
          withDot: true,
          buttonVariant: 'danger' as const,
          buttonClassName: '!bg-stone-900 hover:!bg-stone-800 !text-white',
          borderColor: isCarryOver ? 'border-l-orange-500 dark:border-l-orange-400' : 'border-l-emerald-500 dark:border-l-emerald-400',
          breathClass: isCarryOver ? 'motion-safe:animate-border-breathe-warning' : 'motion-safe:animate-border-breathe-success',
          disabled: false,
        };
      case 'on_break':
        return {
          label: '休憩中…',
          badgeLabel: '休憩中',
          badgeTone: 'warning' as const,
          withDot: true,
          buttonVariant: 'primary' as const,
          buttonClassName: '',
          borderColor: 'border-l-orange-500 dark:border-l-orange-400',
          breathClass: 'motion-safe:animate-border-breathe-warning',
          disabled: true,
        };
    }
  };

  const config = getButtonConfig();
  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;
  const elapsedMin = activeRecord?.clock_in ? differenceInMinutes(currentTime, parseISO(activeRecord.clock_in)) : 0;
  const totalBreakMin = (() => {
    if (!activeRecord) return 0;
    let total = 0;
    for (const brk of activeRecord.breaks ?? []) {
      if (brk.start_time) {
        const end = brk.end_time ? parseISO(brk.end_time) : currentTime;
        total += Math.max(0, differenceInMinutes(end, parseISO(brk.start_time)));
      }
    }
    return total;
  })();
  const elapsedH = Math.floor(elapsedMin / 60);
  const elapsedM = elapsedMin % 60;
  const elapsedText = elapsedH > 0 ? `${elapsedH}時間${elapsedM}分` : `${elapsedM}分`;
  const breakElapsedText = totalBreakMin > 0 ? `${totalBreakMin}分` : null;
  const statusKey = `${status}-${isCarryOver ? 'carry' : 'same'}`;

  useEffect(() => {
    if (prevStatusKeyRef.current === '') {
      prevStatusKeyRef.current = statusKey;
      return;
    }
    if (prevStatusKeyRef.current === statusKey) return;
    prevStatusKeyRef.current = statusKey;

    // TRANS-1 (Loop9): 300ms だけ animation を pause し、
    // border-left-color transition を発火させる。
    setIsTransitioning(true);
    const transTimer = window.setTimeout(() => {
      setIsTransitioning(false);
    }, 300);

    const node = badgeWrapperRef.current;
    if (!node) {
      return () => window.clearTimeout(transTimer);
    }
    node.classList.remove('motion-safe:animate-badge-pop');
    void node.offsetWidth;
    node.classList.add('motion-safe:animate-badge-pop');
    const popTimer = window.setTimeout(() => {
      node.classList.remove('motion-safe:animate-badge-pop');
    }, 360);
    return () => {
      window.clearTimeout(transTimer);
      window.clearTimeout(popTimer);
    };
  }, [statusKey]);

  return (
    <div
      className={`relative w-full overflow-hidden border-l-4 border-stone-200/70 px-0 py-1 dark:border-stone-700 motion-safe:transition-[border-left-color] motion-safe:duration-300 motion-safe:ease-out ${config.borderColor} ${isTransitioning ? '' : config.breathClass}`}
      data-transitioning={isTransitioning || undefined}
      aria-busy={processing || undefined}
    >
      {processing && (
        <div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden rounded-t-lg">
          <div className="h-full w-1/3 bg-blue-500 motion-safe:animate-progress-stripe" />
        </div>
      )}

      <div className="flex justify-center">
        <span ref={badgeWrapperRef} className="inline-flex">
          <Badge
            tone={config.badgeTone}
            withDot={config.withDot}
            role="status"
            aria-live="polite"
          >
            {config.badgeLabel}
          </Badge>
        </span>
      </div>

      <div className="mt-6 flex items-end justify-center gap-1 text-stone-900 dark:text-stone-50 md:mt-7">
        <span className="sr-only">{format(currentTime, 'H時m分')}</span>
        <span
          aria-hidden="true"
          className="font-num text-[64px] font-semibold leading-none tabular-nums md:text-[88px]"
        >
          {format(currentTime, 'HH')}
          <span className="motion-safe:animate-colon-blink">:</span>
          {format(currentTime, 'mm')}
        </span>
        <span
          aria-hidden="true"
          className="mb-1 font-num text-sm tabular-nums text-stone-500 opacity-70 dark:text-stone-400 md:mb-2"
        >
          :{format(currentTime, 'ss')}
        </span>
      </div>
      <p className="mt-1 text-center text-sm text-stone-500 dark:text-stone-300 tabular-nums">
        {format(currentTime, 'yyyy年 M月d日 (E)', { locale: ja })}
      </p>

      {activeRecord?.clock_in && status !== 'not_started' && (
        <div
          key={`elapsed-${status}`}
          className="mt-4 text-center text-sm text-stone-500 motion-safe:animate-fade-in-soft dark:text-stone-300"
        >
          {status === 'on_break' ? (
            <div>
              勤務時間 <span className="font-num tabular-nums">{elapsedText}</span>
              {activeRecord.breaks && breakElapsedText && (
                <>
                  <span className="px-1" aria-hidden="true">（</span>
                  休憩 <span className="font-num tabular-nums">{breakElapsedText}</span>
                  <span aria-hidden="true">）</span>
                </>
              )}
            </div>
          ) : (
            <>
              出勤 <span className="font-num tabular-nums">{formatTime(activeRecord.clock_in)}</span>
              <span className="px-2" aria-hidden="true">
                ・
              </span>
              経過 <span className="font-num tabular-nums">{elapsedText}</span>
            </>
          )}
        </div>
      )}

      {(status === 'not_started' || status === 'working') && (
        <div className="mt-6">
          <Button
            variant={config.buttonVariant}
            size="lg"
            fullWidth
            onClick={handleClick}
            disabled={config.disabled || processing}
            aria-label={config.label}
            loading={processing}
            className={`min-h-[64px] motion-safe:active:scale-[0.97] ${config.buttonClassName}`}
          >
            {config.label}
          </Button>
        </div>
      )}

      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
