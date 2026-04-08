import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AttendanceRecord, Break } from '../../types';

interface BreakButtonProps {
  status: 'not_started' | 'working' | 'on_break';
  breakStart: () => Promise<void>;
  breakEnd: () => Promise<void>;
  activeRecord: AttendanceRecord | null;
  activeBreak: Break | null;
}

export function BreakButton({ status, breakStart, breakEnd, activeRecord, activeBreak }: BreakButtonProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'working' && status !== 'on_break') return null;
  if (!activeRecord) return null;

  const formatTime = (iso: string | null | undefined) => iso ? format(parseISO(iso), 'HH:mm') : null;

  const handleBreakStart = async () => {
    if (processing) return;
    setProcessing(true);
    setError(null);
    try {
      await breakStart();
    } catch (err: any) {
      setError(err.message || '休憩開始に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  const handleBreakEnd = async () => {
    if (processing) return;
    setProcessing(true);
    setError(null);
    try {
      await breakEnd();
    } catch (err: any) {
      setError(err.message || '休憩終了に失敗しました');
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
          className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-8 rounded-lg transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? '処理中...' : '休憩開始'}
        </button>
      )}
      {status === 'on_break' && (
        <>
          <button
            onClick={handleBreakEnd}
            disabled={processing}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-8 rounded-lg transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? '処理中...' : '休憩終了'}
          </button>
          {activeBreak?.start_time && (
            <p className="text-sm text-gray-500">休憩開始: {formatTime(activeBreak.start_time)}</p>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {activeRecord?.breaks && activeRecord.breaks.filter(b => b.end_time !== null).length > 0 && (
        <div className="mt-2 w-full max-w-xs">
          <p className="text-xs text-gray-400 mb-1 text-center">休憩履歴</p>
          <div className="space-y-1">
            {activeRecord.breaks.filter(b => b.end_time !== null).map((brk, index) => (
              <div key={brk.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                <span className="text-gray-500">休憩{index + 1}</span>
                <div className="flex gap-2">
                  <span className="text-gray-700">{formatTime(brk.start_time)}</span>
                  <span className="text-gray-400">〜</span>
                  <span className="text-gray-700">{formatTime(brk.end_time)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
