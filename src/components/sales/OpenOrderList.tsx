import { useState, Fragment } from 'react';
import type { LineItem, OpenOrder, Discount } from '../../lib/sales/types';
import { formatYen } from './utils';
import { Card, Badge } from '../ui';
import { EmptyState } from './ui';
import { MSG } from '../../lib/sales/messages';
import { MOTION } from '../../lib/sales/motion';
import { ErrorBanner, TableSkeleton } from '../ui';

// =============================================================================
// OpenOrderList — 未会計伝票一覧（square-dashboard 見本の kintai 版・W4-P2）
// -----------------------------------------------------------------------------
// 見本（square-dashboard/src/components/OpenOrderList.tsx）からのスリム移植。
//   - ui: square-dashboard 独自 ui.tsx → kintai 共通 ui（Card/Badge）+ sales/ui（EmptyState）
//   - ErrorState → ErrorBanner（共通 ui）、ListSkeleton → TableSkeleton（共通 ui）
//   - 型: lib/sales/types（OpenOrder/LineItem/Discount）
//   - formatYen: components/sales/utils
//   - MSG / MOTION: lib/sales
//   - Card は TransactionList と同型（padding="none" + Card.Header）。
//   - 機能（行展開・明細マージ・カテゴリ並び・コピー）は見本踏襲。
//   - open-orders の error は本コンポーネント内で自前表示（当日売上全体は潰さない）。
// =============================================================================

interface OpenOrderListProps {
  orders: OpenOrder[];
  loading: boolean;
  error: string | null;
}

const CATEGORY_ORDER = ['客タイプ', 'チャージ', 'シーシャ', 'ドリンク', 'フード'];
function getCategoryRank(category: string | null | undefined): number {
  if (!category) return CATEGORY_ORDER.length;
  const idx = CATEGORY_ORDER.findIndex((c) => category.includes(c) || c.includes(category));
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u00A0\u3000\u2060]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function mergeLineItems(items: LineItem[]): LineItem[] {
  const map = new Map<
    string,
    { quantity: number; amount: number; originalName: string; merged: boolean }
  >();

  for (const item of items) {
    const key = normalizeName(item.name);
    const qty = parseFloat(item.quantity) || 0;
    if (map.has(key)) {
      const acc = map.get(key)!;
      acc.quantity = Math.round((acc.quantity + qty) * 1e10) / 1e10;
      acc.amount = Math.round((acc.amount + item.amount) * 1e10) / 1e10;
    } else {
      map.set(key, { quantity: qty, amount: item.amount, originalName: item.name.trim(), merged: false });
    }
  }

  return items
    .map((item) => {
      const key = normalizeName(item.name);
      const acc = map.get(key)!;
      if (!acc.merged) {
        acc.merged = true;
        return { ...item, name: acc.originalName, quantity: String(acc.quantity), amount: acc.amount };
      }
      return null;
    })
    .filter(Boolean) as LineItem[];
}

function stripBrackets(name: string): string {
  return name.replace(/[\[［][^\]］]*[\]］]/g, '').trim();
}

function buildCopyText(items: LineItem[], discounts?: Discount[]): string {
  const sorted = mergeLineItems(items).sort(
    (a, b) => getCategoryRank(a.category) - getCategoryRank(b.category),
  );
  const lines = sorted.map(
    (item) =>
      `${stripBrackets(item.name)} × ${item.quantity}  ${
        item.amount > 0 ? formatYen(item.amount) : '¥0'
      }`,
  );
  if (discounts && discounts.length > 0) {
    for (const d of discounts) {
      lines.push(`${d.name}  -${formatYen(Math.abs(d.amount))}`);
    }
  }
  return lines.join('\n');
}

export default function OpenOrderList({ orders, loading, error }: OpenOrderListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopy = async (e: React.MouseEvent, order: OpenOrder) => {
    e.stopPropagation();
    const text = buildCopyText(order.line_items, order.discounts);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(order.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard API not available (e.g. non-HTTPS)
    }
  };

  if (loading) {
    return (
      <Card padding="none">
        <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">未会計伝票</Card.Header>
        <div className="p-4">
          <TableSkeleton rows={5} />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="none">
        <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">未会計伝票</Card.Header>
        <div className="p-4">
          <ErrorBanner message={error} />
        </div>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card padding="none">
        <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">未会計伝票</Card.Header>
        <EmptyState title={MSG.empty.openOrders} description={MSG.empty.openOrdersHint} />
      </Card>
    );
  }

  return (
    <Card padding="none">
      <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">
        <span className="flex items-center gap-2">
          未会計伝票
          <Badge tone="warning">{orders.length}件</Badge>
        </span>
      </Card.Header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="hidden md:table-header-group bg-stone-50 border-b border-stone-200 dark:bg-stone-800 dark:border-stone-700">
            <tr>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                時刻
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                顧客
              </th>
              <th scope="col" className="text-right px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                金額
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <Fragment key={order.id}>
                <tr
                  className={`block md:table-row border-b border-stone-200 last:border-0 even:bg-stone-50/60 hover:bg-stone-100/60 dark:border-stone-700 dark:even:bg-stone-800/40 dark:hover:bg-stone-800/60 ${MOTION.fast} ${
                    order.line_items.length > 0
                      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500'
                      : ''
                  }`}
                  onClick={() => order.line_items.length > 0 && toggleExpand(order.id)}
                  {...(order.line_items.length > 0
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-expanded': expandedIds.has(order.id),
                        'aria-label': expandedIds.has(order.id) ? '伝票明細を折りたたむ' : '伝票明細を展開',
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpand(order.id);
                          }
                        },
                      }
                    : {})}
                >
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                    <span className="inline-flex items-start gap-1">
                      {order.line_items.length > 0 && (
                        <span className="text-stone-500 dark:text-stone-400 mt-0.5" aria-hidden="true">
                          {expandedIds.has(order.id) ? '▼' : '▶'}
                        </span>
                      )}
                      <span>
                        {order.created_at
                          ? `${new Date(order.created_at).toLocaleString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })} 開始`
                          : '--/-- --:-- 開始'}
                      </span>
                    </span>
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 whitespace-nowrap">
                    {order.customer_name ? (
                      <Badge tone="warning">{order.customer_name}</Badge>
                    ) : (
                      <span className="text-stone-500 dark:text-stone-400">-</span>
                    )}
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-900 dark:text-stone-100 font-semibold md:text-right whitespace-nowrap tabular-nums">
                    {formatYen(order.total_money)}
                  </td>
                </tr>
                {expandedIds.has(order.id) && order.line_items.length > 0 && (
                  <tr className="block md:table-row bg-stone-100/50 border-b border-stone-200 last:border-0 dark:bg-stone-800/40 dark:border-stone-700">
                    <td colSpan={3} className="block md:table-cell px-6 py-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <ul className="space-y-1">
                            {mergeLineItems(order.line_items)
                              .sort(
                                (a, b) =>
                                  getCategoryRank(a.category) - getCategoryRank(b.category),
                              )
                              .map((item, i) => (
                                <li
                                  key={i}
                                  className="flex justify-between text-xs text-stone-600 dark:text-stone-300"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span>
                                      {stripBrackets(item.name)} × {item.quantity}
                                    </span>
                                  </span>
                                  <span className="font-medium">
                                    {item.amount > 0 ? formatYen(item.amount) : '¥0'}
                                  </span>
                                </li>
                              ))}
                          </ul>
                          {order.discounts && order.discounts.length > 0 && (
                            <div className="border-t border-stone-200 dark:border-stone-700 mt-1 pt-1 space-y-1">
                              {order.discounts.map((d, i) => (
                                <div
                                  key={i}
                                  className="flex justify-between text-xs text-red-500"
                                >
                                  <span>{d.name}</span>
                                  <span>-{formatYen(Math.abs(d.amount))}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleCopy(e, order)}
                          aria-label="注文内容をコピー"
                          className={`ml-4 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 rounded ${MOTION.fast}`}
                        >
                          {copiedId === order.id ? (
                            <span role="status" aria-live="polite">
                              <span aria-hidden="true">✓</span> {MSG.cta.copied}
                            </span>
                          ) : (
                            MSG.cta.copy
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
