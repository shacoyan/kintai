import { useState } from 'react';
import { differenceInSeconds, format, parseISO } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { AttendanceRecord, Break } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { useNow } from '../../hooks/useNow';
import { Button } from '../ui';
import { Spinner } from '../ui/Spinner';

interface BreakButtonProps {
  status: 'not_started' | 'working' | 'on_break';
  breakStart: () => Promise<void>;
  breakEnd: () => Promise<void>;
  activeRecord: AttendanceRecord | null;
  activeBreak: Break | null;
}

export function BreakButton({ status, breakStart, breakEnd, activeRecord, activeBreak }: BreakButtonProps) {
  const { showToast } = useToast();
  const [processing, setProcessing] = useState(false);
  const currentTime = useNow(1000);

  if (status !== 'working' && status !== 'on_break') return null;
  if (!activeRecord) return null;

  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;
  const formatBreakDuration = (startTime: string) => {
    const totalSeconds = Math.max(0, differenceInSeconds(currentTime, parseISO(startTime)));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  };

  const handleBreakStart = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      await breakStart();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleBreakEnd = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      await breakEnd();
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const completedBreaks = (activeRecord.breaks ?? []).filter((b) => b.end_time !== null);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {status === 'working' && (
        <button
          onClick={handleBreakStart}
          disabled={processing}
          aria-label="休憩開始"
          className="group inline-flex min-h-[44px] items-center gap-1 rounded-md px-3 py-2 text-orange-700 underline-offset-4 hover:text-orange-700 hover:underline focus-ring disabled:cursor-not-allowed disabled:opacity-50 dark:text-orange-200 dark:hover:text-orange-100"
        >
          {processing && <Spinner size="sm" inline className="mr-1" />}
          <span>休憩開始</span>
          <ChevronRight
            className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      )}
      {status === 'on_break' && (
        <>
          <Button
            variant="warning"
            size="lg"
            fullWidth
            onClick={handleBreakEnd}
            disabled={processing}
            aria-label="休憩終了"
            loading={processing}
            className="min-h-[64px] motion-safe:active:scale-[0.97]"
          >
            休憩終了
          </Button>
          {activeBreak?.start_time && (
            <>
              <p className="text-sm text-neutral-600 dark:text-neutral-200" aria-live="off">
                休憩継続 <span className="font-num tabular-nums">{formatBreakDuration(activeBreak.start_time)}</span>
              </p>
              <p className="text-sm text-neutral-500 dark:text-neutral-300">休憩開始: {formatTime(activeBreak.start_time)}</p>
            </>
          )}
        </>
      )}

      {completedBreaks.length > 0 && (
        <div className="mt-2 w-full max-w-md">
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1 text-center">休憩履歴</p>
          <div className="space-y-1">
            {completedBreaks.map((brk, index) => (
              <div key={brk.id} className="flex items-center justify-between text-xs bg-neutral-50 dark:bg-neutral-700 rounded px-2 py-1">
                <span className="text-neutral-500 dark:text-neutral-300">休憩{index + 1}</span>
                <div className="flex gap-2">
                  <span className="text-neutral-700 dark:text-neutral-300">{formatTime(brk.start_time)}</span>
                  <span className="text-neutral-400 dark:text-neutral-500">〜</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{formatTime(brk.end_time)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
