import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Ban, AlertTriangle, Clock, UserX } from 'lucide-react';
import type { ShiftMismatch } from '../../utils/shiftMismatch';
import { Card, Badge, Button, EmptyState, Heading } from '../ui';
import type { BadgeTone } from '../ui';
import { messages } from '../../lib/messages';

interface ShiftMismatchAlertProps {
  mismatches: ShiftMismatch[];
  memberNames: Map<string, string>;
  onRequestCorrection?: (userId: string, date: string) => void;
}

function typeIcon(type: ShiftMismatch['type']): React.ReactNode {
  switch (type) {
    case 'no_record':   return <Ban className="w-4 h-4" />;
    case 'late':        return <AlertTriangle className="w-4 h-4" />;
    case 'early_leave': return <Clock className="w-4 h-4" />;
    case 'absent':      return <UserX className="w-4 h-4" />;
    default:            return <AlertTriangle className="w-4 h-4" />;
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

function typeBadgeTone(type: ShiftMismatch['type']): BadgeTone {
  switch (type) {
    case 'no_record':
    case 'absent':
      return 'danger';
    case 'late':
    case 'early_leave':
      return 'warning';
    default:
      return 'neutral';
  }
}

function rowBgClass(type: ShiftMismatch['type']): string {
  switch (type) {
    case 'no_record':
    case 'absent':
      return 'bg-red-50 dark:bg-red-800/20 border-red-100 dark:border-red-700';
    case 'late':
      return 'bg-orange-50 dark:bg-orange-800/20 border-orange-100 dark:border-orange-700';
    case 'early_leave':
      return 'bg-orange-50 dark:bg-orange-800/20 border-orange-100 dark:border-orange-700';
    default:
      return 'bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700';
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
      <EmptyState
        title={messages.empty.shiftMismatch.title}
        description={messages.empty.shiftMismatch.description}
      />
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
          <Card key={date} padding="none">
            <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-700 flex items-center gap-3">
              <Heading level={4} as="h3" className="text-stone-700 dark:text-stone-200">{dateLabel}</Heading>
              <Badge tone="neutral">{items.length}件</Badge>
            </div>

            <ul className="divide-y divide-stone-100 dark:divide-stone-700">
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
                          <span className="font-medium text-stone-900 dark:text-stone-100 text-sm">{name}</span>
                          <Badge tone={typeBadgeTone(m.type)} icon={typeIcon(m.type)}>{typeLabel(m.type)}</Badge>
                        </div>

                        <p className="text-sm text-stone-700 dark:text-stone-300 mb-1.5">{m.message}</p>

                        <div className="text-xs text-stone-500 dark:text-stone-300 space-y-0.5">
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onRequestCorrection(m.userId, m.date)}
                        >
                          修正を依頼
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
