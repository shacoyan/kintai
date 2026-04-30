import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { BottomSheet } from '../ui/BottomSheet';
import { ErrorBanner } from '../ui/ErrorBanner';
import { formatSupabaseError } from '../../lib/errors';
import { AlertTriangle } from 'lucide-react';

type TenantDeleteSectionProps = {
  tenantId: string;
};

export const TenantDeleteSection: React.FC<TenantDeleteSectionProps> = ({ tenantId: _tenantId }) => {
  const { currentTenant, isOwner, deleteTenant } = useTenant();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await deleteTenant();
      setIsOpen(false);
      navigate('/tenant');
    } catch (e: unknown) {
      const f = formatSupabaseError(e);
      setError(f.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card className="border-danger-300">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-danger-700 dark:text-danger-300" />
            <h3 className="text-heading-2 text-danger-700 dark:text-danger-300">
              テナントを削除する
            </h3>
          </div>

          <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-6 leading-relaxed">
            テナントを削除すると、所属メンバー全員のアクセスが停止します。データは法定保管期間後に削除されます。この操作は取り消せません。
          </p>

          {!isOwner && (
            <div className="mb-4">
              <ErrorBanner message="オーナーのみ実行可能です" />
            </div>
          )}

          <Button
            variant="danger"
            className="bg-danger-600 dark:bg-danger-500 text-white hover:bg-danger-700 dark:hover:bg-danger-400"
            disabled={!isOwner}
            onClick={() => setIsOpen(true)}
          >
            テナントを削除する
          </Button>
        </div>
      </Card>

      <BottomSheet
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
          setConfirmText('');
          setError(null);
        }}
        title="テナント削除の確認"
      >
        <div className="p-4 space-y-4">
          <div className="bg-danger-50 dark:bg-danger-900 border border-danger-200 dark:border-danger-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-danger-600 dark:text-danger-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-danger-800 dark:text-danger-300 font-medium mb-1">
                  警告: この操作は取り消せません
                </p>
                <p className="text-sm text-danger-700 dark:text-danger-300">
                  テナント名 「{currentTenant?.name}」 を入力して確認してください。
                </p>
              </div>
            </div>
          </div>

          <Input
            value={confirmText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmText(e.target.value)}
            placeholder="テナント名を入力"
          />

          {error && <ErrorBanner message={error} />}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setIsOpen(false);
                setConfirmText('');
                setError(null);
              }}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="bg-danger-600 dark:bg-danger-500 text-white hover:bg-danger-700 dark:hover:bg-danger-400 disabled:opacity-50"
              disabled={confirmText !== currentTenant?.name || submitting}
              onClick={handleDelete}
            >
              {submitting ? '削除中...' : '削除を実行'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
};
