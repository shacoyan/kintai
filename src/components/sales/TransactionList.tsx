import { useState, Fragment } from 'react';
import type { LineItem, Transaction, Discount } from '../../lib/sales/types';
import { formatYen } from './utils';
import { Card, Badge, type BadgeTone } from '../ui';
import { EmptyState } from './ui';
import { MSG } from '../../lib/sales/messages';
import { MOTION } from '../../lib/sales/motion';
import { TableSkeleton } from '../ui';

// =============================================================================
// TransactionList — 決済済み伝票一覧（square-dashboard 見本の kintai 版・W4-P1）
// -----------------------------------------------------------------------------
// 見本（square-dashboard/src/components/TransactionList.tsx）からのスリム移植。
//   - ui: square-dashboard 独自 ui.tsx → kintai 共通 ui（Card/Badge）+ sales/ui（EmptyState）
//   - 型: lib/sales/types（Transaction/LineItem/Discount）
//   - formatYen: components/sales/utils
//   - MSG / MOTION: lib/sales
//   - StatusBadge は Badge(tone/children) に合わせて size prop を撤去。
//   - 機能（行展開・明細マージ・カテゴリ並び・コピー）は見本踏襲。
// =============================================================================

interface TransactionListProps {
  transactions: Transaction[];
  loading: boolean;
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

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function StatusBadge({ status }: { status: string }) {
  let tone: BadgeTone = 'neutral';
  let label = status;
  if (status === 'COMPLETED') {
    tone = 'success';
    label = '成功';
  } else if (status === 'FAILED') {
    tone = 'danger';
    label = '失敗';
  }
  return <Badge tone={tone}>{label}</Badge>;
}

export default function TransactionList({ transactions, loading }: TransactionListProps) {
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

  const handleCopy = async (e: React.MouseEvent, tx: Transaction) => {
    e.stopPropagation();
    const text = buildCopyText(tx.line_items, tx.discounts);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(tx.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard API not available (e.g. non-HTTPS)
    }
  };

  if (loading) {
    return (
      <Card padding="none">
        <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">決済済み伝票</Card.Header>
        <div className="p-4">
          <TableSkeleton rows={5} />
        </div>
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card padding="none">
        <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">決済済み伝票</Card.Header>
        <EmptyState title={MSG.empty.transactions} />
      </Card>
    );
  }

  return (
    <Card padding="none">
      <Card.Header className="px-4 md:px-6 pt-4 md:pt-6">決済済み伝票</Card.Header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="hidden md:table-header-group bg-stone-50 border-b border-stone-200 dark:bg-stone-800 dark:border-stone-700">
            <tr>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                時刻
              </th>
              <th scope="col" className="text-right px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                金額
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                支払い方法
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                顧客
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">
                ステータス
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <Fragment key={tx.id}>
                <tr
                  className={`block md:table-row border-b border-stone-200 last:border-0 even:bg-stone-50/60 hover:bg-stone-100/60 dark:border-stone-700 dark:even:bg-stone-800/40 dark:hover:bg-stone-800/60 ${MOTION.fast} ${
                    tx.line_items.length > 0
                      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500'
                      : ''
                  }`}
                  onClick={() => tx.line_items.length > 0 && toggleExpand(tx.id)}
                  {...(tx.line_items.length > 0
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-expanded': expandedIds.has(tx.id),
                        'aria-label': expandedIds.has(tx.id) ? '伝票明細を折りたたむ' : '伝票明細を展開',
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpand(tx.id);
                          }
                        },
                      }
                    : {})}
                >
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                    <span className="inline-flex items-start gap-1">
                      {tx.line_items.length > 0 && (
                        <span className="text-stone-500 dark:text-stone-400 mt-0.5" aria-hidden="true">
                          {expandedIds.has(tx.id) ? '▼' : '▶'}
                        </span>
                      )}
                      <span className="flex flex-col leading-tight">
                        {tx.order_created_at_jst &&
                          formatHHMM(tx.order_created_at_jst) !== formatHHMM(tx.created_at_jst) && (
                            <span className="text-[10px] text-stone-500 dark:text-stone-400">
                              開始 {formatHHMM(tx.order_created_at_jst)}
                            </span>
                          )}
                        <span>
                          {tx.created_at_jst
                            ? new Date(tx.created_at_jst).toLocaleTimeString('ja-JP')
                            : '-'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-900 dark:text-stone-100 font-semibold md:text-right whitespace-nowrap tabular-nums">
                    {formatYen(tx.amount)}
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                    {tx.source}
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                    {tx.customer_name ?? '-'}
                  </td>
                  <td className="block md:table-cell px-2 py-1 md:px-4 md:py-3 whitespace-nowrap">
                    <StatusBadge status={tx.status} />
                  </td>
                </tr>
                {expandedIds.has(tx.id) && tx.line_items.length > 0 && (
                  <tr className="block md:table-row bg-stone-100/50 border-b border-stone-200 last:border-0 dark:bg-stone-800/40 dark:border-stone-700">
                    <td colSpan={5} className="block md:table-cell px-6 py-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <ul className="space-y-1">
                            {mergeLineItems(tx.line_items)
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
                          {tx.discounts && tx.discounts.length > 0 && (
                            <div className="border-t border-stone-200 dark:border-stone-700 mt-1 pt-1 space-y-1">
                              {tx.discounts.map((d, i) => (
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
                          onClick={(e) => handleCopy(e, tx)}
                          aria-label="注文内容をコピー"
                          className={`ml-4 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 rounded ${MOTION.fast}`}
                        >
                          {copiedId === tx.id ? (
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
