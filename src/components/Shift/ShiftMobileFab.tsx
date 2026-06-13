import React, { useState, useCallback } from 'react';
import { Plus, CalendarPlus, ListChecks, UserPlus } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';

interface ShiftMobileFabProps {
  /** テナント管理権限（manager 系）。true のとき「新規シフト追加」項目を表示。 */
  canManageTenant: boolean;
  /** 締切後 & bypass 不可など、申請操作を抑止したいときに true。 */
  disabled?: boolean;
  /** 「シフト希望を申請」= 選択日 preference 出勤可/不可。 */
  onRequestPreference: () => void;
  /** 「まとめて申請」= bulk mode 開始。 */
  onBulkRequest: () => void;
  /** 「新規シフト追加」= manager のみ。canManageTenant=true かつ未指定なら項目は出さない。 */
  onAddShift?: () => void;
}

type MenuItem = {
  key: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  onSelect: () => void;
};

/**
 * SP 用の右下フローティング申請ボタン（FAB）+ 下から出る小 BottomSheet メニュー。
 * - FAB: fixed 円形 blue-600。BottomNav（md:hidden）干渉対策で < md は safe-area + 4.5rem 上へ逃がす。
 * - 配置側（ShiftPage / Engineer F）が lg:hidden 配下に置き、bulk mode 中は非表示にする。
 */
const ShiftMobileFab: React.FC<ShiftMobileFabProps> = ({
  canManageTenant,
  disabled = false,
  onRequestPreference,
  onBulkRequest,
  onAddShift,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const handleSelect = useCallback(
    (action: () => void) => {
      setMenuOpen(false);
      action();
    },
    [],
  );

  const items: MenuItem[] = [
    {
      key: 'request-preference',
      label: 'シフト希望を申請',
      description: '選択中の日の出勤可/不可を申請',
      icon: <CalendarPlus className="w-5 h-5" />,
      onSelect: () => handleSelect(onRequestPreference),
    },
    {
      key: 'bulk-request',
      label: 'まとめて申請',
      description: '複数日をまとめて希望提出',
      icon: <ListChecks className="w-5 h-5" />,
      onSelect: () => handleSelect(onBulkRequest),
    },
  ];

  if (canManageTenant && onAddShift) {
    items.push({
      key: 'add-shift',
      label: '新規シフト追加',
      description: '選択中の日にスタッフのシフトを追加',
      icon: <UserPlus className="w-5 h-5" />,
      onSelect: () => handleSelect(onAddShift),
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="シフト申請メニュー"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={() => setMenuOpen(true)}
        className={
          'fixed right-4 z-40 h-14 w-14 rounded-full flex items-center justify-center shadow-lg ' +
          'bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-4 ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ' +
          'motion-safe:transition-transform active:scale-95 ' +
          (disabled
            ? 'bg-stone-300 text-stone-500 dark:bg-stone-700 dark:text-stone-500 cursor-not-allowed shadow-none'
            : 'bg-blue-600 text-white hover:bg-blue-700')
        }
      >
        <Plus className="w-6 h-6" />
      </button>

      <BottomSheet
        isOpen={menuOpen}
        onClose={closeMenu}
        title="シフト申請"
        widthClassName="md:max-w-sm"
      >
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onSelect}
              className="w-full min-h-[48px] flex items-center gap-3 rounded-lg px-3 py-3 text-left
                         bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700
                         text-stone-900 dark:text-stone-50
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                         motion-safe:transition-colors duration-150 ease-out"
            >
              <span className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full
                               bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                {item.icon}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{item.label}</span>
                {item.description && (
                  <span className="text-xs text-stone-500 dark:text-stone-400">{item.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
};

export default ShiftMobileFab;
export { ShiftMobileFab };
