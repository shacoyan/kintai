import { useState, useEffect, useRef } from 'react';
import { Store, Check, ChevronDown, AlertCircle } from 'lucide-react';
import { useStoreContext } from '../../contexts/StoreContext';
import { useTenant } from '../../hooks/useTenant';
import { Badge } from '../ui';

export function StoreSelector() {
  const { stores, currentStore, setCurrentStore, isManagerOf } = useStoreContext();
  const { isOwner } = useTenant();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen]);

  function getRoleBadge(storeId: string) {
    if (isOwner) return <Badge tone="primary">Owner</Badge>;
    if (isManagerOf(storeId)) return <Badge tone="info">店長</Badge>;
    return null;
  }

  if (stores.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <div className="flex flex-col">
          <span>店舗が割り当てられていません</span>
          {isOwner ? (
            <a
              href="/admin?tab=stores"
              className="text-primary-600 dark:text-primary-400 hover:underline mt-0.5"
            >
              店舗を作成してください →
            </a>
          ) : (
            <span className="text-amber-500 dark:text-amber-300 mt-0.5">
              オーナー or 店長に連絡してください
            </span>
          )}
        </div>
      </div>
    );
  }

  if (stores.length === 1) {
    const store = stores[0];
    return (
      <div className="flex items-center gap-2 min-h-9">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {store.name}
        </span>
        {getRoleBadge(store.id)}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={currentStore?.name || '店舗を選択'}
        className="flex items-center gap-2 max-w-[160px] min-h-9 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium border border-slate-300 dark:border-slate-700 rounded-md px-3 py-1 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
      >
        <Store className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="truncate">{currentStore?.name || '店舗を選択'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        {currentStore && getRoleBadge(currentStore.id)}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto"
        >
          {stores.map((store) => {
            const isSelected = store.id === currentStore?.id;
            return (
              <button
                key={store.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setCurrentStore(store);
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:bg-slate-100 dark:focus:bg-slate-700 transition-colors"
              >
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {isSelected && <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />}
                </span>
                <span className="flex-1 truncate text-slate-900 dark:text-slate-100">
                  {store.name}
                </span>
                {isOwner ? (
                  <Badge tone="primary">Owner</Badge>
                ) : isManagerOf(store.id) ? (
                  <Badge tone="info">店長</Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
