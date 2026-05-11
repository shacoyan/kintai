import { format } from 'date-fns';
import { Heading } from '../ui/Heading';

interface LaborCostEstimate {
  userId: string;
  displayName: string;
  payType: 'hourly' | 'monthly';
  shiftMinutes: number;
  nightMinutes: number;
  estimatedCost: number;
}

interface LaborCostSummaryProps {
  estimates: LaborCostEstimate[];
  targetMonth?: Date;
}

export function LaborCostSummary({ estimates, targetMonth }: LaborCostSummaryProps) {
  const totalCost = estimates.reduce((s, e) => s + e.estimatedCost, 0);
  const totalMinutes = estimates.reduce((s, e) => s + e.shiftMinutes, 0);
  const totalNightMinutes = estimates.reduce((s, e) => s + e.nightMinutes, 0);

  const fmtTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  if (estimates.length === 0) return null;

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
        <Heading level={2}>人件費サマリー</Heading>
        <p className="text-sm text-neutral-500 dark:text-neutral-300 mt-0.5">
          {targetMonth
            ? `${format(targetMonth, 'yyyy年M月')} の見込み人件費（承認済 + 申請中）`
            : '承認済・申請中のシフトの見込み人件費'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[600px] w-full divide-y divide-neutral-200 dark:divide-neutral-700">
          <thead className="bg-neutral-50 dark:bg-neutral-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 min-w-[120px] whitespace-nowrap">名前</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">給与形態</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">通常</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">深夜</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">合計</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-300 whitespace-nowrap">見込み額</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700 tabular-nums">
            {estimates.map((e) => (
              <tr key={e.userId} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50">
                <td className="px-6 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{e.displayName}</td>
                <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">
                  {e.payType === 'monthly' ? '月給' : '時給'}
                </td>
                <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.shiftMinutes - e.nightMinutes)}</td>
                <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.nightMinutes)}</td>
                <td className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 text-right whitespace-nowrap">{fmtTime(e.shiftMinutes)}</td>
                <td className="px-6 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">
                  ¥{e.estimatedCost.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr className="bg-neutral-50 dark:bg-neutral-700/50 border-t-2 border-neutral-300 dark:border-neutral-600">
              <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 whitespace-nowrap">合計</td>
              <td className="px-6 py-3 text-right text-neutral-900 dark:text-neutral-100 whitespace-nowrap">-</td>
              <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(totalMinutes - totalNightMinutes)}</td>
              <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(totalNightMinutes)}</td>
              <td className="px-6 py-3 text-sm font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">{fmtTime(totalMinutes)}</td>
              <td className="px-6 py-3 text-base font-bold text-neutral-900 dark:text-neutral-100 text-right whitespace-nowrap">¥{totalCost.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
