import type { FC } from 'react';

interface PayrollSlipPrintViewProps {
  storeName: string;
  year: number;
  month: number;
  rows: Array<{
    userId: string;
    displayName: string;
    payType: 'hourly' | 'monthly';
    hourlyRate: number;
    monthlySalary: number;
    workDays: number;
    normalMinutes: number;
    nightMinutes: number;
    payment: number;
  }>;
}

const PayrollSlipPrintView: FC<PayrollSlipPrintViewProps> = ({ storeName, year, month, rows }) => {
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const formatMinutesToHM = (totalMinutes: number): string => {
    if (totalMinutes === 0) return '0:00';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${pad2(m)}`;
  };

  const monthStr = `${year}年${pad2(month)}月`;

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 1.5cm;
          }
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }

        @media screen {
          .print-area {
            display: none;
          }
        }

        .print-area {
          font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
          color: #000;
          background: #fff;
        }

        .slip-page {
          page-break-after: always;
          padding-bottom: 20px;
          box-sizing: border-box;
        }
        .slip-page:last-child {
          page-break-after: auto;
        }

        .slip-header {
          border-bottom: 2px solid #000;
          padding-bottom: 12px;
          margin-bottom: 16px;
          text-align: center;
        }
        .slip-title {
          font-size: 20px;
          font-weight: bold;
          margin: 0 0 8px 0;
        }
        .slip-meta {
          font-size: 14px;
          margin: 0;
        }

        .slip-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 24px;
          font-size: 14px;
        }

        .slip-table th,
        .slip-table td {
          border: 1px solid #000;
          padding: 10px 12px;
          text-align: left;
        }

        .slip-table th {
          background-color: #f5f5f5;
          font-weight: bold;
          width: 140px;
          white-space: nowrap;
        }

        .slip-table td {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .slip-payment-row th {
          background-color: #e8e8e8;
          border-bottom: 2px solid #000;
        }

        .slip-payment-row td {
          font-size: 18px;
          font-weight: bold;
          border-bottom: 2px solid #000;
        }

        .slip-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 40px;
          padding-top: 20px;
        }

        .slip-signature {
          font-size: 14px;
        }

        .signature-line {
          display: inline-block;
          width: 150px;
          border-bottom: 1px solid #000;
          margin-left: 8px;
        }

        .slip-rate-note {
          font-size: 12px;
          color: #444;
          margin-top: 4px;
        }
      `}</style>

      <div className="print-area">
        {rows.map((row) => (
          <div key={row.userId} className="slip-page">
            <div className="slip-header">
              <h1 className="slip-title">給与明細書</h1>
              <p className="slip-meta">
                {storeName} / {monthStr}支給分
              </p>
            </div>

            <table className="slip-table">
              <tbody>
                <tr>
                  <th>氏名</th>
                  <td style={{ textAlign: 'left' }}>{row.displayName}</td>
                </tr>
                <tr>
                  <th>出勤日数</th>
                  <td>{row.workDays}日</td>
                </tr>
                <tr>
                  <th>通常時間</th>
                  <td>{formatMinutesToHM(row.normalMinutes)}</td>
                </tr>
                <tr>
                  <th>深夜時間</th>
                  <td>{formatMinutesToHM(row.nightMinutes)}</td>
                </tr>
                <tr>
                  <th>
                    {row.payType === 'hourly' ? '時給' : '月給'}
                  </th>
                  <td>
                    {row.payType === 'hourly' ? (
                      <>
                        {row.hourlyRate.toLocaleString()}円
                        <div className="slip-rate-note">(時給単価)</div>
                      </>
                    ) : (
                      <>
                        {row.monthlySalary.toLocaleString()}円
                        <div className="slip-rate-note">(月給固定)</div>
                      </>
                    )}
                  </td>
                </tr>
                <tr className="slip-payment-row">
                  <th>支給額</th>
                  <td>{row.payment.toLocaleString()}円</td>
                </tr>
              </tbody>
            </table>

            <div className="slip-footer">
              <div>
                {row.payType === 'hourly' ? '時給制' : '月給制'}勤務者
              </div>
              <div className="slip-signature">
                受領者署名：<span className="signature-line"></span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export { PayrollSlipPrintView };
export type { PayrollSlipPrintViewProps };
