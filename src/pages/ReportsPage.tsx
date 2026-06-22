// =============================================================================
// pages/ReportsPage.tsx — 日報 / 月報タブ container（Loop D/E・D-2 単独所有）
// -----------------------------------------------------------------------------
// 設計書 §2 / §4。`/reports` 単一ルート + ページ内「日報」「月報」タブ。
//   - 日報タブ = DailyReportPanel（店舗/日付セレクタ + Square サマリ + 入力フォーム）。
//   - 月報タブ = E-2 の MonthlyReportPanel を lazy import で 1 行結線（契約名準拠）。
//     E-2 未完成でも import + Suspense で配線だけしておく（統合時にビルド確認）。
//   - タブ状態は useUrlState<'daily'|'monthly'>('tab') で URL ?tab= へ双方向同期（T7）。
//     WAI-ARIA tabs（role=tab/tablist/tabpanel）。
// =============================================================================

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useUrlState } from '../hooks/useUrlState';
import { useReportStores } from '../hooks/useReportStores';
import { useDailyReport } from '../hooks/useDailyReport';
import { getBusinessDate } from '../lib/sales/businessDate';
import { STORE_START_HOUR } from '../lib/reports/types';
import {
  EmptyState,
  ErrorBanner,
  PageLoader,
  DashboardSkeleton,
  Heading,
} from '../components/ui';
import { StoreDatePicker } from '../components/reports/StoreDatePicker';
import { DailySquareSummary } from '../components/reports/DailySquareSummary';
import { DailyReportForm } from '../components/reports/DailyReportForm';

// 月報タブ本体は E-2 が所有（MonthlyReportPanel）。結線は 1 行 lazy import に縮約（§7）。
const MonthlyReportPanel = lazy(() =>
  import('../components/reports/MonthlyReportPanel').then((m) => ({
    default: m.MonthlyReportPanel,
  }))
);

type ReportTab = 'daily' | 'monthly';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'daily', label: '日報' },
  { key: 'monthly', label: '月報' },
];

// T7（2026-06-18 監査 §4-10）: 日報/月報タブを URL ?tab= へ双方向同期。
// /reports?tab=monthly 直アクセスで月報に着地、リロード/戻るで復元、共有可。
// 書き戻しは useUrlState 内で functional updater + { replace: true } のため
// 他クエリを温存し履歴も汚さない。/reports に他の 'tab' 使用箇所は無い
// （AdminDashboard は別ルートの adminTab、ShiftPage は /shift で legacy tab を削除）。
const REPORT_TABS = ['daily', 'monthly'] as const;

export function ReportsPage(): JSX.Element {
  const [tab, setTab] = useUrlState<ReportTab>('tab', REPORT_TABS, 'daily');

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-6">
      <Heading level={1}>日報・月報</Heading>

      {/* タブ */}
      <div
        role="tablist"
        aria-label="日報・月報"
        className="flex gap-1 border-b border-stone-200 dark:border-stone-700"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              id={`report-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`report-panel-${t.key}`}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px motion-safe:transition-colors ' +
                (active
                  ? 'border-blue-500 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                  : 'border-transparent text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200')
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 日報タブ */}
      {tab === 'daily' ? (
        <div role="tabpanel" id="report-panel-daily" aria-labelledby="report-tab-daily">
          <DailyReportPanel />
        </div>
      ) : null}

      {/* 月報タブ（E-2 の MonthlyReportPanel を結線） */}
      {tab === 'monthly' ? (
        <div role="tabpanel" id="report-panel-monthly" aria-labelledby="report-tab-monthly">
          <Suspense fallback={<PageLoader variant="page" />}>
            <MonthlyReportPanel />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyReportPanel — 日報タブ本体（店舗/日付 state + useDailyReport の orchestration）
// ---------------------------------------------------------------------------

function DailyReportPanel(): JSX.Element {
  const { stores, loading: storesLoading } = useReportStores();

  // 営業日（11 時区切り）の当日を既定 / 上限に使う。
  const todayBusinessDate = useMemo(() => getBusinessDate(STORE_START_HOUR), []);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState<string>(todayBusinessDate);

  // stores ロード後に既定店舗を決定（先頭）。
  useEffect(() => {
    if (storeId) return;
    const defaultId = stores[0]?.id ?? null;
    if (defaultId) setStoreId(defaultId);
  }, [storeId, stores]);

  // 選択中 store が stores から消えた場合（テナント切替等）は先頭へ寄せ直す。
  useEffect(() => {
    if (storeId && stores.length > 0 && !stores.some((s) => s.id === storeId)) {
      setStoreId(stores[0]?.id ?? null);
    }
  }, [storeId, stores]);

  const { data, loading, error, saving, saveDailyReport } = useDailyReport(storeId, businessDate);

  if (storesLoading) {
    return <DashboardSkeleton />;
  }

  if (stores.length === 0) {
    return (
      <EmptyState
        title="対象店舗がありません"
        description="日報を入力できる店舗が割り当てられていません。管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="space-y-6">
      <StoreDatePicker
        stores={stores}
        storeId={storeId}
        businessDate={businessDate}
        onStoreChange={setStoreId}
        onDateChange={setBusinessDate}
        maxDate={todayBusinessDate}
        disabled={saving}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {/* T11（2026-06-18 監査 §4-10）: 保存後の reload で全画面スケルトンに差し替えると
          入力が消えたように見えるフラッシュが起きる。既に表示中のデータがある間の
          再取得（保存直後 reload 含む）は前回表示を保持し、薄い opacity ディミング +
          aria-busy で「更新中」を伝えるに留める。データ未取得時のみ初回スケルトンを出す。
          SR には aria-live='polite' で更新状態を通知する（保存 toast は Form 側で維持）。 */}
      {loading && !data ? (
        <DashboardSkeleton />
      ) : data ? (
        data.scope_ok ? (
          <div
            className={
              'space-y-6 motion-safe:transition-opacity' +
              (loading ? ' opacity-60' : '')
            }
            aria-busy={loading}
          >
            <DailySquareSummary report={data} />
            <DailyReportForm report={data} saving={saving} onSave={saveDailyReport} />
          </div>
        ) : (
          <EmptyState
            title="権限がありません"
            description="この店舗の日報を表示・編集する権限がありません。"
            tone="warning"
          />
        )
      ) : !error ? (
        <EmptyState
          title="店舗と営業日を選択してください"
          description="Square 集計と入力フォームが表示されます。"
        />
      ) : null}

      {/* SR への更新状態通知（視覚的には非表示）。 */}
      <div aria-live="polite" className="sr-only">
        {loading && data ? '最新の内容を更新しています' : ''}
      </div>
    </div>
  );
}

export default ReportsPage;
