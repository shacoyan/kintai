// FILE: components/Tenant/JoinTenant.tsx
import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { formatSupabaseError } from '../../lib/errors';

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
    } catch (err: unknown) {
      // L12-8: joinTenant が throw する friendly Error.message
      // (期限切れ / 使用回数上限 / 重複参加 等) をそのまま表示する
      setError(formatSupabaseError(err).message || '参加に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const displayError = error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-neutral-800 p-8 rounded-lg shadow-md border border-neutral-100 dark:border-neutral-700">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-6">招待コードで参加</h2>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              招待コード <span className="text-danger-500 dark:text-danger-400">*</span>
            </label>
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg shadow-sm font-mono text-lg tracking-widest text-center uppercase bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="ABC123"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              表示名 <span className="text-danger-500 dark:text-danger-400">*</span>
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg shadow-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="例: 山田 太郎"
              disabled={loading}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={onCancel}
              variant="tertiary"
              className="flex-1"
              disabled={loading}
            >
              戻る
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={loading}
            >
              {loading ? '参加中...' : '参加する'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinTenant;
