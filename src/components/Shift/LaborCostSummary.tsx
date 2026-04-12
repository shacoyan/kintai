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
}

export function LaborCostSummary({ estimates }: LaborCostSummaryProps) {
  const totalCost = estimates.reduce((s, e) => s + e.estimatedCost, 0);
  const totalMinutes = estimates.reduce((s, e) => s + e.shiftMinutes, 0);

  const fmtTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  if (estimates.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">人件費サマリー</h2>
        <p className="text-sm text-gray-500 mt-0.5">承認済・申請中シフトの見込み人件費</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">名前</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">給与形態</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">シフト時間</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">見込み額</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {estimates.map((e) => (
              <tr key={e.userId} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-sm font-medium text-gray-900">{e.displayName}</td>
                <td className="px-6 py-3 text-sm text-gray-700 text-right">
                  {e.payType === 'monthly' ? '月給' : '時給'}
                </td>
                <td className="px-6 py-3 text-sm text-gray-700 text-right">{fmtTime(e.shiftMinutes)}</td>
                <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                  ¥{e.estimatedCost.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50 border-t-2 border-gray-300">
              <td className="px-6 py-3 text-sm font-bold text-gray-900">合計</td>
              <td className="px-6 py-3 text-right">-</td>
              <td className="px-6 py-3 text-sm font-bold text-gray-900 text-right">{fmtTime(totalMinutes)}</td>
              <td className="px-6 py-3 text-base font-bold text-gray-900 text-right">¥{totalCost.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
