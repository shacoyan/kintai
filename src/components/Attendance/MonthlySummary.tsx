import { Calendar, Coffee, TrendingUp } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { Heading } from '../ui';
import { messages } from '../../lib/messages';

interface MonthlySummaryProps {
  summary: {
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    workDays: number;
    avgWorkMinutes: number;
  };
}

export function MonthlySummary({ summary }: MonthlySummaryProps) {
  if (summary.workDays === 0 && summary.totalWorkMinutes === 0) {
    return (
      <EmptyState
        icon={<Calendar className="w-12 h-12 text-stone-400 dark:text-stone-500" />}
        title={messages.empty.attendanceMonth.title}
        description={messages.empty.attendanceMonth.description}
      />
    );
  }

  const formatMinutes = (minutes: number) => {
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${h}時間${m}分`;
  };

  const subStats = [
    { label: '出勤日数', value: `${summary.workDays}日`, Icon: Calendar },
    { label: '総休憩時間', value: formatMinutes(summary.totalBreakMinutes), Icon: Coffee },
    { label: '平均労働時間', value: formatMinutes(summary.avgWorkMinutes), Icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Heading level={1} as="h2">
          今月労働時間
        </Heading>
        <p className="text-3xl sm:text-4xl tabular-nums font-bold text-stone-800 dark:text-stone-200 mt-2">
          {formatMinutes(summary.totalWorkMinutes)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {subStats.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-center text-sm text-stone-500 dark:text-stone-300 mb-1">
              <Icon className="h-4 w-4 mr-1.5 text-stone-400 dark:text-stone-500" />
              {label}
            </div>
            <span className="text-xl sm:text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-200">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
