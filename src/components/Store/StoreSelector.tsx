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
      className="text-sm bg-white/10 text-white border border-white/20 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-white/30"
    >
      <option value="">全店舗</option>
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
