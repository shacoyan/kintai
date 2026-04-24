import { Calendar, Coffee, TrendingUp } from 'lucide-react';

interface MonthlySummaryProps {
  summary: {
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    workDays: number;
    avgWorkMinutes: number;
  };
}

export function MonthlySummary({ summary }: MonthlySummaryProps) {
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
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          今月労働時間
        </h2>
        <p className="text-4xl tabular-nums font-bold text-gray-800 dark:text-gray-200 mt-2">
          {formatMinutes(summary.totalWorkMinutes)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {subStats.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-1">
              <Icon className="h-4 w-4 mr-1.5 text-gray-400 dark:text-gray-500" />
              {label}
            </div>
            <span className="text-2xl font-bold tabular-nums text-gray-800 dark:text-gray-200">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
