import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { ShiftMismatch } from '../../utils/shiftMismatch';

interface ShiftMismatchAlertProps {
  mismatches: ShiftMismatch[];
  memberNames: Map<string, string>;
  onRequestCorrection?: (userId: string, date: string) => void;
}

function typeIcon(type: ShiftMismatch['type']): string {
  switch (type) {
    case 'no_record': return '🚫';
    case 'late':      return '⚠️';
    case 'early_leave': return '⏰';
    case 'absent':    return '🚫';
    default:          return '⚠️';
  }
}

function typeLabel(type: ShiftMismatch['type']): string {
  switch (type) {
    case 'no_record':   return '出勤記録なし';
    case 'late':        return '遅刻';
    case 'early_leave': return '早退';
    case 'absent':      return '欠勤';
    default:            return '不一致';
  }
}

function rowBgClass(type: ShiftMismatch['type']): string {
  switch (type) {
    case 'no_record':
    case 'absent':
      return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'late':
      return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    case 'early_leave':
      return 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800';
    default:
      return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
}

function badgeClass(type: ShiftMismatch['type']): string {
  switch (type) {
    case 'no_record':
    case 'absent':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    case 'late':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400';
    case 'early_leave':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm');
  } catch {
    return iso;
  }
}

export function ShiftMismatchAlert({
  mismatches,
  memberNames,
  onRequestCorrection,
}: ShiftMismatchAlertProps) {
  if (mismatches.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400 text-sm">シフト不一致はありません</p>
      </div>
    );
  }

  // Group by date
  const byDate = new Map<string, ShiftMismatch[]>();
  for (const m of mismatches) {
    const list = byDate.get(m.date) ?? [];
    list.push(m);
    byDate.set(m.date, list);
  }

  const sortedDates = Array.from(byDate.keys()).sort();

  return (
    <div className="space-y-4">
      {sortedDates.map(date => {
        const items = byDate.get(date)!;
        const dateLabel = (() => {
          try {
            return format(parseISO(date), 'M月d日(E)', { locale: ja });
          } catch {
            return date;
          }
        })();

        return (
          <div key={date} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{dateLabel}</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {items.length}件
              </span>
            </div>

            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((m, idx) => {
                const name = memberNames.get(m.userId) ?? m.userId;
                return (
                  <li
                    key={`${m.shiftId}-${idx}`}
                    className={`px-5 py-4 border-l-4 ${rowBgClass(m.type)}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-base">{typeIcon(m.type)}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{name}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass(m.type)}`}>
                            {typeLabel(m.type)}
                          </span>
                        </div>

                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-1.5">{m.message}</p>

                        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                          <p>シフト: {m.shiftStart} 〜 {m.shiftEnd}</p>
                          {(m.actualStart || m.actualEnd) && (
                            <p>
                              実績:
                              {m.actualStart && ` 出勤 ${formatTime(m.actualStart)}`}
                              {m.actualEnd && ` 退勤 ${formatTime(m.actualEnd)}`}
                            </p>
                          )}
                          {m.diffMinutes > 0 && (
                            <p>差分: {m.diffMinutes}分</p>
                          )}
                        </div>
                      </div>

                      {onRequestCorrection && (
                        <button
                          onClick={() => onRequestCorrection(m.userId, m.date)}
                          className="shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 whitespace-nowrap"
                        >
                          修正を依頼
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
