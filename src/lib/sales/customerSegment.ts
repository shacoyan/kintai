import type { Transaction, SegmentBreakdown, AcquisitionBreakdown } from './types';

export function countCustomersByTransaction(tx: Transaction): SegmentBreakdown {
  const initial: SegmentBreakdown = { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0 };
  const result = tx.line_items.reduce<SegmentBreakdown>((acc, item) => {
    const name = item.name;
    const quantity = Math.round(parseFloat(item.quantity) || 0);
    if (name.includes('新規')) {
      acc.new += quantity;
    }
    if (name.includes('リピート')) {
      acc.repeat += quantity;
    }
    if (name.includes('常連')) {
      acc.regular += quantity;
    }
    if (name.includes('スタッフ')) {
      acc.staff += quantity;
    }
    return acc;
  }, initial);

  const total = result.new + result.repeat + result.regular + result.staff;
  if (total === 0) {
    return { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 1 };
  }
  return result;
}

export function allocateSalesByTransaction(tx: Transaction): SegmentBreakdown {
  const counts = countCustomersByTransaction(tx);
  const total = counts.new + counts.repeat + counts.regular + counts.staff;

  if (total === 0) {
    return { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: tx.amount };
  }

  const baseSales: Pick<SegmentBreakdown, 'new' | 'repeat' | 'regular' | 'staff'> = {
    new: Math.floor((tx.amount * counts.new) / total),
    repeat: Math.floor((tx.amount * counts.repeat) / total),
    regular: Math.floor((tx.amount * counts.regular) / total),
    staff: Math.floor((tx.amount * counts.staff) / total),
  };
  const remainder = tx.amount - baseSales.new - baseSales.repeat - baseSales.regular - baseSales.staff;

  // 端数の寄せ先: 常連>0なら常連、そうでなければカウント最大のセグメント
  // 同数タイブレークは new > repeat > staff の優先順
  let targetKey: 'new' | 'repeat' | 'regular' | 'staff';
  if (counts.regular > 0) {
    targetKey = 'regular';
  } else {
    const priority: ('new' | 'repeat' | 'staff')[] = ['new', 'repeat', 'staff'];
    targetKey = priority.reduce((max, k) => (counts[k] > counts[max] ? k : max), priority[0]);
  }
  baseSales[targetKey] += remainder;

  return { ...baseSales, unlisted: 0 };
}

// NOTE: Wave4（BIG-1：Square api 直叩きの取引明細データ源）で UI 配線予定。現状は
// aggregateSegments から呼ばれるテスト/将来用。削除しない。
export function detectAcquisitionChannels(tx: Transaction): AcquisitionBreakdown {
  const result: AcquisitionBreakdown = { google: 0, review: 0, signboard: 0, sns: 0, unknown: 0 };
  let newQty = 0;
  for (const item of tx.line_items) {
    if (item.name.includes('新規')) newQty += Math.round(parseFloat(item.quantity) || 0);
  }
  if (newQty === 0) return result;
  for (const item of tx.line_items) {
    const qty = Math.round(parseFloat(item.quantity) || 0);
    const name = item.name;
    if (name.includes('Google')) result.google += qty;
    if (name.includes('口コミ') || name.includes('クチコミ')) result.review += qty;
    if (name.includes('看板')) result.signboard += qty;
    if (name.includes('SNS')) result.sns += qty;
  }
  const channelTotal = result.google + result.review + result.signboard + result.sns;
  result.unknown = Math.max(0, newQty - channelTotal);
  return result;
}

// NOTE: Wave4（BIG-1/BIG-3：取引明細データ源）で使用予定。現状はテスト/将来用。削除しない。
export function aggregateSegments(transactions: Transaction[]): {
  customers: SegmentBreakdown;
  sales: SegmentBreakdown;
  acquisition: AcquisitionBreakdown;
} {
  const customers: SegmentBreakdown = { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0 };
  const sales: SegmentBreakdown = { new: 0, repeat: 0, regular: 0, staff: 0, unlisted: 0 };
  const acquisition: AcquisitionBreakdown = { google: 0, review: 0, signboard: 0, sns: 0, unknown: 0 };

  for (const tx of transactions) {
    const txCustomers = countCustomersByTransaction(tx);
    customers.new += txCustomers.new;
    customers.repeat += txCustomers.repeat;
    customers.regular += txCustomers.regular;
    customers.staff += txCustomers.staff;
    customers.unlisted += txCustomers.unlisted;

    const txSales = allocateSalesByTransaction(tx);
    sales.new += txSales.new;
    sales.repeat += txSales.repeat;
    sales.regular += txSales.regular;
    sales.staff += txSales.staff;
    sales.unlisted += txSales.unlisted;

    const txAcquisition = detectAcquisitionChannels(tx);
    acquisition.google += txAcquisition.google;
    acquisition.review += txAcquisition.review;
    acquisition.signboard += txAcquisition.signboard;
    acquisition.sns += txAcquisition.sns;
    acquisition.unknown += txAcquisition.unknown;
  }

  return { customers, sales, acquisition };
}
