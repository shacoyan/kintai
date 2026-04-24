// FILE: components/Tenant/CreateTenant.tsx
import React, { useState } from 'react';
import type { Tenant } from '../../types';
import { CheckCircle2, Copy, Check } from 'lucide-react';
import { ErrorBanner } from '../ui/ErrorBanner';

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
    } catch (err: any) {
      setError(err.message || 'ワークスペースの作成に失敗しました');
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-100 dark:border-gray-700">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">ワークスペースを作成しました</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">以下の招待コードをチームメンバーに共有してください</p>
          </div>

          <div className="mt-6 bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">招待コード</p>
            <div className="flex items-center gap-3">
              <p className="text-3xl font-mono font-bold tracking-widest text-gray-900 dark:text-gray-100 flex-1 text-center">
                {createdTenant.invite_code}
              </p>
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors inline-flex items-center"
              >
                {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? 'コピー済' : 'コピー'}
              </button>
            </div>
          </div>

          <button
            onClick={() => onCreate(createdTenant)}
            className="mt-6 w-full btn-primary py-2.5 px-4 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            ワークスペースに進む
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-100 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">新しいワークスペースを作成</h2>

        {displayError && (
          <div className="mb-4">
            <ErrorBanner message={displayError} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ワークスペース名 <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="例: 営業部"
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
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="例: 山田 太郎"
              disabled={loading}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-ghost py-2.5 px-4 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              disabled={loading}
            >
              戻る
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary py-2.5 px-4 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? '作成中...' : '作成する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTenant;
