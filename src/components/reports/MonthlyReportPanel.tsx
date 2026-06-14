import React, { useEffect, useMemo, useState } from 'react';
import { Select } from '../ui';
import { useTenant } from '../../contexts/TenantContext';
import { useReportStores } from '../../hooks/useReportStores';
import { useMonthlyReport } from '../../hooks/useMonthlyReport';
import { useMonthlyReportAll } from '../../hooks/useMonthlyReportAll';
import { useStoreMonthlySettings } from '../../hooks/useStoreMonthlySettings';
import { getBusinessDate } from '../../lib/sales/businessDate';
import { STORE_START_HOUR } from '../../lib/reports/types';
import { MonthSelector } from './MonthSelector';
import { MonthlyStoreReport } from './MonthlyStoreReport';
import { MonthlyAllReport } from './MonthlyAllReport';
import { StoreMonthlySettingsEditor } from './StoreMonthlySettingsEditor';

// =============================================================================
// MonthlyReportPanel — 月報タブ全体（Loop E §5.1〜§5.5）
// -----------------------------------------------------------------------------
//   - ReportsPage（D-2）からは `<MonthlyReportPanel />` を 1 行で結線する（§7・R9）。
//   - 年月セレクタ（既定=当月 = getBusinessDate(11) の年月）＋ サブタブ
//     「店舗別 / 総合」。総合タブは managerial のみ描画（myRole 判定 ＋ RPC null の
//     二層 fail-safe・§5.1 / §5.4）。
//   - 店舗別: 店舗セレクタ + useMonthlyReport + 月次マスタ編集（managerial）。
//   - 総合: useMonthlyReportAll（managerial のみ enabled）。
//   - 金額は円カンマ区切り（万単位は使わない）／レートは %。
// =============================================================================

type SubTab = 'store' | 'all';

/** 'YYYY-MM-DD' → { year, month(1..12) }。 */
function parseYearMonth(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split('-');
  return { year: Number(y), month: Number(m) };
}

export const MonthlyReportPanel: React.FC = () => {
  const { myRole, currentTenant } = useTenant();
  const { stores } = useReportStores();
  const isManagerial = myRole === 'owner' || myRole === 'manager';

  // 既定 = 当月（営業日区切り 11 時基準の年月）。
  const initial = useMemo(() => parseYearMonth(getBusinessDate(STORE_START_HOUR)), []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);

  const [subTab, setSubTab] = useState<SubTab>('store');
  const [storeId, setStoreId] = useState<string | null>(null);

  // テナント切替時は選択中の storeId をリセットする（前テナントの store id が
  // 残ると新テナントに存在せず月報が空表示になるため。DailyReportPanel と同型）。
  // effectiveStoreId が新テナントの先頭店舗にフォールバックして空表示を解消する。
  useEffect(() => {
    setStoreId(null);
  }, [currentTenant?.id]);

  // store が後から解決された場合の初期補完（ユーザー選択は上書きしない）。
  const effectiveStoreId = storeId ?? stores[0]?.id ?? null;

  const handleMonthChange = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
  };

  // ---- データ取得 ----
  const report = useMonthlyReport(effectiveStoreId, year, month, currentTenant?.id ?? null);
  const reportAll = useMonthlyReportAll(year, month, currentTenant?.id ?? null, isManagerial);
  const settings = useStoreMonthlySettings(
    isManagerial ? currentTenant?.id ?? null : null,
    isManagerial ? effectiveStoreId : null,
    isManagerial ? year : null,
    isManagerial ? month : null,
  );

  const storeOptions = useMemo(
    () => stores.map((s) => ({ value: s.id, label: s.name })),
    [stores],
  );

  return (
    <div className="space-y-5">
      {/* 年月セレクタ + サブタブ */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <MonthSelector year={year} month={month} onChange={handleMonthChange} />

        <div
          role="tablist"
          aria-label="月報の表示切替"
          className="inline-flex rounded-lg bg-stone-100 p-1 dark:bg-stone-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'store'}
            onClick={() => setSubTab('store')}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              subTab === 'store'
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-50'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            店舗別
          </button>
          {isManagerial && (
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'all'}
              onClick={() => setSubTab('all')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                subTab === 'all'
                  ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-50'
                  : 'text-stone-600 dark:text-stone-300'
              }`}
            >
              総合
            </button>
          )}
        </div>
      </div>

      {/* 店舗別ビュー */}
      {subTab === 'store' && (
        <div className="space-y-4">
          <div className="max-w-xs">
            <Select
              label="店舗"
              value={effectiveStoreId ?? ''}
              options={storeOptions}
              placeholder="店舗を選択"
              onChange={(e) => setStoreId(e.target.value || null)}
            />
          </div>

          <MonthlyStoreReport
            data={report.data}
            loading={report.loading}
            error={report.error}
            isManagerial={isManagerial}
            onReload={report.reload}
          />

          {/* 月次マスタ編集（managerial のみ・二層防御） */}
          {isManagerial && effectiveStoreId && (
            <StoreMonthlySettingsEditor
              settings={settings}
              tenantId={currentTenant?.id ?? null}
              year={year}
              month={month}
              onSaved={() => {
                report.reload();
              }}
            />
          )}
        </div>
      )}

      {/* 総合ビュー（managerial のみ・サブタブ自体 staff 非描画 + RPC null 二層） */}
      {subTab === 'all' && isManagerial && (
        <MonthlyAllReport
          data={reportAll.data}
          loading={reportAll.loading}
          error={reportAll.error}
          isManagerial={isManagerial}
          onReload={reportAll.reload}
        />
      )}
    </div>
  );
};

export default MonthlyReportPanel;
