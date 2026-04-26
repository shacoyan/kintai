import { useStoreContext } from '../../contexts/StoreContext';

export function StoreSelector() {
  const { stores, currentStore, setCurrentStore } = useStoreContext();

  // 店舗未割当の場合の表示
  if (stores.length === 0) {
    return (
      <span
        className="text-xs text-amber-600 dark:text-amber-400"
        title="店舗が割り当てられていません。店長 or オーナーに連絡してください。"
      >
        店舗未割当
      </span>
    );
  }

  return (
    <select
      value={currentStore?.id || ''}
      onChange={(e) => {
        const store = stores.find(s => s.id === e.target.value) || null;
        setCurrentStore(store);
      }}
      aria-label="店舗切替"
      className="text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
    >
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
