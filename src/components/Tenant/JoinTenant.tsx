import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { Heading } from '../ui';
import { Input } from '../ui/Input';
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
        <Heading level={2} className="mb-6">招待コードで参加</Heading>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input label="招待コード" required maxLength={6} value={inviteCode} onChange={(e)=>setInviteCode(e.target.value.toUpperCase())} placeholder="ABC123" disabled={loading} className="font-mono text-lg tracking-widest text-center uppercase" hint="6 桁の英数字" id="inviteCode" />

          <Input label="表示名" required value={displayName} onChange={(e)=>setDisplayName(e.target.value)} placeholder="例: 山田 太郎" disabled={loading} id="displayName" />

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
              loading={loading}
            >
              参加する
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinTenant;
