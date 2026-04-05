// FILE: components/Attendance/MonthlySummary.tsx

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
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}時間${m}分`;
  };

  const stats = [
    { label: '総労働時間', value: formatMinutes(summary.totalWorkMinutes) },
    { label: '出勤日数', value: `${summary.workDays}日` },
    { label: '平均労働時間', value: formatMinutes(summary.avgWorkMinutes) },
    { label: '総休憩時間', value: formatMinutes(summary.totalBreakMinutes) },
  ];

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="grid grid-cols-2 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col">
            <span className="text-sm text-gray-500 mb-1">{stat.label}</span>
            <span className="text-2xl font-bold text-gray-800">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
