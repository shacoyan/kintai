import React, { useEffect, useMemo, useState } from 'react';
import { useSalesScope } from '../hooks/useSalesScope';
import { Card, PageLoader, EmptyState } from '../components/ui';

// =============================================================================
// SalesPage — Square 売上ダッシュボード（Loop1: ルート + スケルトン）
// -----------------------------------------------------------------------------
// useSalesScope() で閲覧スコープ（許可 location 名集合 / 全店可否）を取得し、
// 店舗セレクタを描画する。
//   - canViewAll（owner / manager）→「全店（ALL）」+ allowedLocationNames
//   - staff（canViewAll=false）   → allowedLocationNames（自店）のみ
// 本文の売上表示は Loop2 で実装。ここではプレースホルダのみ。
// =============================================================================

const ALL_VALUE = '__ALL__';

export const SalesPage: React.FC = () => {
  const { allowedLocationNames, canViewAll, loading } = useSalesScope();

  // セレクタの選択肢を組み立てる
  const options = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (canViewAll) {
      opts.push({ value: ALL_VALUE, label: '全店（ALL）' });
    }
    for (const name of allowedLocationNames) {
      opts.push({ value: name, label: name });
    }
    return opts;
  }, [canViewAll, allowedLocationNames]);

  // 選択 state（ローカル）。canViewAll なら全店、それ以外は先頭店舗を初期選択。
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (loading) return;
    if (options.length === 0) {
      setSelected('');
      return;
    }
    // 現在の選択肢に存在しなければ初期値へ寄せる
    if (!options.some((o) => o.value === selected)) {
      setSelected(canViewAll ? ALL_VALUE : options[0].value);
    }
  }, [loading, options, selected, canViewAll]);

  if (loading) {
    return <PageLoader variant="screen" label="読み込み中" />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">売上</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">Square 売上ダッシュボード</p>
        </div>

        {allowedLocationNames.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="sales-store-select"
              className="text-sm text-stone-600 dark:text-stone-300"
            >
              店舗
            </label>
            <select
              id="sales-store-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {allowedLocationNames.length === 0 ? (
        <EmptyState
          title="対象店舗の売上データがありません"
          description="閲覧可能な Square 店舗が見つかりませんでした。"
        />
      ) : (
        <Card>
          <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
            ここに売上が入ります（Loop2 で実装）
          </div>
        </Card>
      )}
    </div>
  );
};

export default SalesPage;
