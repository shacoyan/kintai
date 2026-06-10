// =============================================================================
// components/reports/StoreDatePicker.tsx — 店舗 + 営業日セレクタ（Loop D §4.1）
// -----------------------------------------------------------------------------
//   - 店舗: useStoreContext().stores（UUID 直渡し・Square 名変換不要・§1.2）。
//     owner=全店 / manager・staff=所属店（StoreContext が既に絞る）。
//   - 日付: ネイティブ <input type=date>。既定 = getBusinessDate(11)（§1.7）。
//   - stores ロード中は Skeleton、stores 空は EmptyState（上位 DailyReportPanel で扱う）。
// =============================================================================

import { Select, Input } from '../ui';

interface Store {
  id: string;
  name: string;
}

interface StoreDatePickerProps {
  stores: Store[];
  storeId: string | null;
  businessDate: string;
  onStoreChange: (storeId: string) => void;
  onDateChange: (date: string) => void;
  /** 入力上限（営業日基準の当日）。未指定なら無制限。 */
  maxDate?: string;
  disabled?: boolean;
}

export function StoreDatePicker({
  stores,
  storeId,
  businessDate,
  onStoreChange,
  onDateChange,
  maxDate,
  disabled,
}: StoreDatePickerProps): JSX.Element {
  const singleStore = stores.length === 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {singleStore ? (
        // 1 店のみ: 読み取りラベル表示（選択肢が 1 個なら選ぶ意味がない・§4.1）。
        <div>
          <span className="block text-xs font-medium text-stone-700 mb-1.5 dark:text-stone-300">
            店舗
          </span>
          <div className="h-9 flex items-center px-3 rounded-md border border-stone-200 bg-stone-50 text-sm text-stone-900 dark:bg-stone-900 dark:border-stone-700 dark:text-stone-100">
            {stores[0].name}
          </div>
        </div>
      ) : (
        <Select
          label="店舗"
          value={storeId ?? ''}
          onChange={(e) => onStoreChange(e.target.value)}
          disabled={disabled}
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}

      <Input
        type="date"
        label="営業日"
        value={businessDate}
        max={maxDate}
        onChange={(e) => onDateChange(e.target.value)}
        disabled={disabled}
        hint="営業日（11 時区切り）"
      />
    </div>
  );
}
