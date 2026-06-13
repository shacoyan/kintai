import { describe, it, expect } from 'vitest';
import {
  getShiftSlot,
  computeSlotCoverage,
  judgeStaffing,
  formatStartHour2,
  extractLastName,
  prioritizeDayItems,
  isSlotWarning,
  SHIFT_SLOT_LABEL,
  SHIFT_SLOT_LABEL_LONG,
  type DayChipItem,
} from './shiftSlot';

describe('getShiftSlot', () => {
  it('境界値: 14:59 → early', () => {
    expect(getShiftSlot('14:59')).toBe('early');
  });
  it('境界値: 15:00 → mid', () => {
    expect(getShiftSlot('15:00')).toBe('mid');
  });
  it('境界値: 17:59 → mid', () => {
    expect(getShiftSlot('17:59')).toBe('mid');
  });
  it('境界値: 18:00 → late', () => {
    expect(getShiftSlot('18:00')).toBe('late');
  });
  it('23:00 → late', () => {
    expect(getShiftSlot('23:00')).toBe('late');
  });
  it('09:00 → early', () => {
    expect(getShiftSlot('09:00')).toBe('early');
  });
  it('HH:mm:ss 形式: "18:00:00" → late', () => {
    expect(getShiftSlot('18:00:00')).toBe('late');
  });
  it('HH:mm:ss 形式: "09:00:00" → early', () => {
    expect(getShiftSlot('09:00:00')).toBe('early');
  });
  it('深夜 00:00 → early（hour<15 で early に倒れる）', () => {
    expect(getShiftSlot('00:00')).toBe('early');
  });
});

describe('computeSlotCoverage', () => {
  it('混在配列で early/mid/late/total を集計', () => {
    const shifts = [
      { start_time: '09:00' },
      { start_time: '12:00' },
      { start_time: '16:00' },
      { start_time: '18:00' },
      { start_time: '22:00' },
    ];
    expect(computeSlotCoverage(shifts)).toEqual({ early: 2, mid: 1, late: 2, total: 5 });
  });
  it('空配列 → 全 0', () => {
    expect(computeSlotCoverage([])).toEqual({ early: 0, mid: 0, late: 0, total: 0 });
  });
  it('HH:mm:ss 形式も集計できる', () => {
    const shifts = [{ start_time: '18:00:00' }, { start_time: '15:30:00' }];
    expect(computeSlotCoverage(shifts)).toEqual({ early: 0, mid: 1, late: 1, total: 2 });
  });
});

describe('judgeStaffing', () => {
  it('0 → unstaffed / 未配置 / danger', () => {
    expect(judgeStaffing(0)).toEqual({ level: 'unstaffed', label: '未配置', tone: 'danger' });
  });
  it('1 → thin / 人手薄 / warning', () => {
    expect(judgeStaffing(1)).toEqual({ level: 'thin', label: '人手薄', tone: 'warning' });
  });
  it('2 → adequate / 適正 / success', () => {
    expect(judgeStaffing(2)).toEqual({ level: 'adequate', label: '適正', tone: 'success' });
  });
  it('4 → adequate / 適正 / success', () => {
    expect(judgeStaffing(4)).toEqual({ level: 'adequate', label: '適正', tone: 'success' });
  });
  it('5 → rich / 手厚い / info', () => {
    expect(judgeStaffing(5)).toEqual({ level: 'rich', label: '手厚い', tone: 'info' });
  });
  it('10 → rich / 手厚い / info', () => {
    expect(judgeStaffing(10)).toEqual({ level: 'rich', label: '手厚い', tone: 'info' });
  });
});

describe('formatStartHour2', () => {
  it('"9:00" → "09"', () => {
    expect(formatStartHour2('9:00')).toBe('09');
  });
  it('"18:30" → "18"', () => {
    expect(formatStartHour2('18:30')).toBe('18');
  });
  it('"18:00:00" → "18"', () => {
    expect(formatStartHour2('18:00:00')).toBe('18');
  });
  it('"09:00" → "09"', () => {
    expect(formatStartHour2('09:00')).toBe('09');
  });
});

describe('extractLastName', () => {
  it('半角スペース区切り "高橋 太郎" → "高橋"', () => {
    expect(extractLastName('高橋 太郎')).toBe('高橋');
  });
  it('区切り無し "高橋太郎" → "高橋"（先頭2文字）', () => {
    expect(extractLastName('高橋太郎')).toBe('高橋');
  });
  it('1 文字名 "林" → "林"', () => {
    expect(extractLastName('林')).toBe('林');
  });
  it('2 文字名 "林大" → "林大"（2文字以下はそのまま）', () => {
    expect(extractLastName('林大')).toBe('林大');
  });
  it('空文字 → "—"', () => {
    expect(extractLastName('')).toBe('—');
  });
  it('undefined → "—"', () => {
    expect(extractLastName(undefined)).toBe('—');
  });
  it('null → "—"', () => {
    expect(extractLastName(null)).toBe('—');
  });
  it('英字名 "Taro Tanaka" → "Taro"（先頭トークン）', () => {
    expect(extractLastName('Taro Tanaka')).toBe('Taro');
  });
  it('全角スペース "山田　花子" → "山田"', () => {
    expect(extractLastName('山田　花子')).toBe('山田');
  });
  it('前後空白のみ "   " → "—"', () => {
    expect(extractLastName('   ')).toBe('—');
  });
  it('複合姓 "佐々木一郎" → "佐々"（先頭2文字の割り切り）', () => {
    expect(extractLastName('佐々木一郎')).toBe('佐々');
  });
});

describe('isSlotWarning', () => {
  it('0 → true', () => {
    expect(isSlotWarning(0)).toBe(true);
  });
  it('1 → false', () => {
    expect(isSlotWarning(1)).toBe(false);
  });
});

describe('SHIFT_SLOT_LABEL / SHIFT_SLOT_LABEL_LONG', () => {
  it('短ラベル', () => {
    expect(SHIFT_SLOT_LABEL).toEqual({ early: '早', mid: '中', late: '遅' });
  });
  it('長ラベル', () => {
    expect(SHIFT_SLOT_LABEL_LONG).toEqual({ early: '早番', mid: '中番', late: '遅番' });
  });
});

describe('prioritizeDayItems', () => {
  const make = (over: Partial<DayChipItem>): DayChipItem => ({
    kind: 'shift',
    userId: 'u',
    startTime: '12:00',
    lastName: '田中',
    roleType: 'parttime',
    status: 'approved',
    isMine: false,
    isManager: false,
    ...over,
  });

  it('自分 > 店長 > 時刻 > 姓 の順', () => {
    const items: DayChipItem[] = [
      make({ userId: 'late', startTime: '18:00', lastName: 'あ' }),
      make({ userId: 'mgr', isManager: true, startTime: '20:00' }),
      make({ userId: 'me', isMine: true, startTime: '22:00' }),
      make({ userId: 'early', startTime: '09:00', lastName: 'い' }),
    ];
    const { visible } = prioritizeDayItems(items, 10);
    expect(visible.map((v) => v.userId)).toEqual(['me', 'mgr', 'early', 'late']);
  });

  it('同時刻は姓昇順', () => {
    const items: DayChipItem[] = [
      make({ userId: 'b', startTime: '12:00', lastName: '渡辺' }),
      make({ userId: 'a', startTime: '12:00', lastName: '青木' }),
    ];
    const { visible } = prioritizeDayItems(items, 10);
    expect(visible.map((v) => v.userId)).toEqual(['a', 'b']);
  });

  it('limit=3 で overflow を計算', () => {
    const items: DayChipItem[] = [
      make({ userId: 'a', startTime: '09:00' }),
      make({ userId: 'b', startTime: '10:00' }),
      make({ userId: 'c', startTime: '11:00' }),
      make({ userId: 'd', startTime: '12:00' }),
      make({ userId: 'e', startTime: '13:00' }),
    ];
    const { visible, overflow } = prioritizeDayItems(items, 3);
    expect(visible).toHaveLength(3);
    expect(visible.map((v) => v.userId)).toEqual(['a', 'b', 'c']);
    expect(overflow).toBe(2);
  });

  it('limit 以下なら overflow=0', () => {
    const items: DayChipItem[] = [make({ userId: 'a' }), make({ userId: 'b' })];
    const { visible, overflow } = prioritizeDayItems(items, 5);
    expect(visible).toHaveLength(2);
    expect(overflow).toBe(0);
  });

  it('空配列 → visible 空 / overflow 0', () => {
    expect(prioritizeDayItems([], 3)).toEqual({ visible: [], overflow: 0 });
  });

  it('完全同条件は入力順を維持（安定ソート）', () => {
    const items: DayChipItem[] = [
      make({ userId: 'x', startTime: '12:00', lastName: '同' }),
      make({ userId: 'y', startTime: '12:00', lastName: '同' }),
      make({ userId: 'z', startTime: '12:00', lastName: '同' }),
    ];
    const { visible } = prioritizeDayItems(items, 10);
    expect(visible.map((v) => v.userId)).toEqual(['x', 'y', 'z']);
  });
});
