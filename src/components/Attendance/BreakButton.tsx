import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AttendanceRecord, Break } from '../../types';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';

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

  if (status !== 'working' && status !== 'on_break') return null;
  if (!activeRecord) return null;

  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;

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

  return (
    <div className="flex flex-col items-center gap-2">
      {status === 'working' && (
        <button
          onClick={handleBreakStart}
          disabled={processing}
          aria-label="休憩開始"
          aria-pressed={false}
          className="bg-neutral-600 hover:bg-neutral-700 dark:bg-neutral-500 text-white font-bold py-3 px-8 rounded-lg motion-safe:transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {processing ? '処理中...' : '休憩開始'}
        </button>
      )}
      {status === 'on_break' && (
        <>
          <button
            onClick={handleBreakEnd}
            disabled={processing}
            aria-label="休憩終了"
            aria-pressed={true}
            className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 text-white font-bold py-3 px-8 rounded-lg motion-safe:transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {processing ? '処理中...' : '休憩終了'}
          </button>
          {activeBreak?.start_time && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">休憩開始: {formatTime(activeBreak.start_time)}</p>
          )}
        </>
      )}

      {activeRecord?.breaks && activeRecord.breaks.filter(b => b.end_time !== null).length > 0 && (
        <div className="mt-2 w-full max-w-xs">
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1 text-center">休憩履歴</p>
          <div className="space-y-1">
            {activeRecord.breaks.filter(b => b.end_time !== null).map((brk, index) => (
              <div key={brk.id} className="flex items-center justify-between text-xs bg-neutral-50 dark:bg-neutral-700 rounded px-2 py-1">
                <span className="text-neutral-500 dark:text-neutral-400">休憩{index + 1}</span>
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
