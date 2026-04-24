import { useStoreContext } from '../../contexts/StoreContext';

export function StoreSelector() {
  const { stores, currentStore, setCurrentStore } = useStoreContext();

  if (stores.length === 0) return null;

  return (
    <select
      value={currentStore?.id || ''}
      onChange={(e) => {
        const store = stores.find(s => s.id === e.target.value) || null;
        setCurrentStore(store);
      }}
      aria-label="店舗切替"
      className="text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    >
      <option value="">全店舗</option>
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
