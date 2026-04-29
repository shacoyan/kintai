// FILE: components/Tenant/CreateTenant.tsx
import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { CheckCircle2, Copy, Check } from 'lucide-react';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { Heading } from '../ui';
import { formatSupabaseError } from '../../lib/errors';

interface CreateTenantProps {
  onCreate: (tenant: Tenant) => void;
  onCancel: () => void;
  createTenant: (name: string, displayName: string) => Promise<Tenant>;
}

const CreateTenant: React.FC<CreateTenantProps> = ({ onCreate, onCancel, createTenant }) => {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<Tenant | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('ワークスペース名を入力してください');
      return;
    }
    if (!displayName.trim()) {
      setError('表示名を入力してください');
      return;
    }

    setLoading(true);
    try {
      const tenant = await createTenant(name.trim(), displayName.trim());
      setCreatedTenant(tenant);
    } catch (err: unknown) {
      setError(formatSupabaseError(err).message || 'ワークスペースの作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (createdTenant) {
      try {
        await navigator.clipboard.writeText(createdTenant.invite_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // HTTPS以外の環境ではclipboard APIが使えないため無視
      }
    }
  };

  const displayError = error;

  if (createdTenant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
        <div className="w-full max-w-md bg-white dark:bg-neutral-800 p-8 rounded-lg shadow-md border border-neutral-100 dark:border-neutral-700">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-success-100 dark:bg-success-900/30 mb-4">
              <CheckCircle2 className="h-6 w-6 text-success-600 dark:text-success-400" />
            </div>
            <Heading level={2}>ワークスペースを作成しました</Heading>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">以下の招待コードをチームメンバーに共有してください</p>
          </div>

          <div className="mt-6 bg-neutral-50 dark:bg-neutral-900 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700">
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-300 mb-2">招待コード</p>
            <div className="flex items-center gap-3">
              <p className="text-3xl font-mono font-bold tracking-widest text-neutral-900 dark:text-neutral-100 flex-1 text-center">
                {createdTenant.invite_code}
              </p>
              <button
                onClick={handleCopy}
                className="px-3 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded hover:bg-primary-100 dark:hover:bg-primary-900/50 motion-safe:transition-colors duration-120 ease-out-expo inline-flex items-center"
              >
                {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? 'コピー済' : 'コピー'}
              </button>
            </div>
          </div>

          <Button
            onClick={() => onCreate(createdTenant)}
            variant="primary"
            fullWidth
            className="mt-6"
          >
            ワークスペースに進む
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-neutral-800 p-8 rounded-lg shadow-md border border-neutral-100 dark:border-neutral-700">
        <Heading level={2} className="mb-6">新しいワークスペースを作成</Heading>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              ワークスペース名 <span className="text-danger-500 dark:text-danger-400">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-primary-500 dark:focus:border-primary-400 dark:bg-neutral-700 dark:text-neutral-100"
              placeholder="例: 営業部"
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
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-primary-500 dark:focus:border-primary-400 dark:bg-neutral-700 dark:text-neutral-100"
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
              loading={loading}
            >
              作成する
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTenant;
