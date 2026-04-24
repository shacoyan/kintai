// FILE: components/Tenant/JoinTenant.tsx
import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';

interface JoinTenantProps {
  onJoin: (tenant: Tenant) => void;
  onCancel: () => void;
  joinTenant: (inviteCode: string, displayName: string) => Promise<Tenant>;
}

const JoinTenant: React.FC<JoinTenantProps> = ({ onJoin, onCancel, joinTenant }) => {
  const [inviteCode, setInviteCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inviteCode.trim()) {
      setError('招待コードを入力してください');
      return;
    }
    if (inviteCode.trim().length !== 6) {
      setError('招待コードは6文字です');
      return;
    }
    if (!displayName.trim()) {
      setError('表示名を入力してください');
      return;
    }

    setLoading(true);
    try {
      const tenant = await joinTenant(inviteCode.trim().toUpperCase(), displayName.trim());
      onJoin(tenant);
    } catch (err: any) {
      setError(err.message || '参加に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const displayError = error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-100 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">招待コードで参加</h2>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              招待コード <span className="text-red-500">*</span>
            </label>
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm font-mono text-lg tracking-widest text-center uppercase bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="ABC123"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              表示名 <span className="text-red-500">*</span>
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="例: 山田 太郎"
              disabled={loading}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost flex-1 py-2.5 px-4"
              disabled={loading}
            >
              戻る
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 py-2.5 px-4"
              disabled={loading}
            >
              {loading ? '参加中...' : '参加する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinTenant;
