import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { CheckCircle2, Copy, Check } from 'lucide-react';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { Heading } from '../ui';
import { Input } from '../ui/Input';
import { formatSupabaseError } from '../../lib/errors';
import { messages } from '../../lib/messages';

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
      setError(messages.validation.required('ワークスペース名'));
      return;
    }
    if (!displayName.trim()) {
      setError(messages.validation.required('表示名'));
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
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-900 p-4">
        <div className="w-full max-w-md bg-white dark:bg-stone-800 p-8 rounded-lg shadow-md border border-stone-100 dark:border-stone-700">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-800/30 mb-4">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <Heading level={2}>ワークスペースを作成しました</Heading>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">以下の招待コードをチームメンバーに共有してください</p>
          </div>

          <div className="mt-6 bg-stone-50 dark:bg-stone-900 p-4 rounded-lg border border-stone-200 dark:border-stone-700">
            <p className="text-xs font-medium text-stone-500 dark:text-stone-300 mb-2">招待コード</p>
            <div className="flex items-center gap-3">
              <p className="text-3xl font-mono font-bold tracking-widest text-stone-900 dark:text-stone-100 flex-1 text-center">
                {createdTenant.invite_code}
              </p>
              <button
                onClick={handleCopy}
                className="px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-800/30 rounded-md hover:bg-blue-50 dark:hover:bg-blue-800/50 motion-safe:transition-colors duration-150 ease-out inline-flex items-center"
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
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-stone-800 p-8 rounded-lg shadow-md border border-stone-100 dark:border-stone-700">
        <Heading level={2} className="mb-6">新しいワークスペースを作成</Heading>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="ワークスペース名"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 営業部"
            disabled={loading}
            id="name"
          />

          <Input
            label="表示名"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: 山田 太郎"
            disabled={loading}
            id="displayName"
          />

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
