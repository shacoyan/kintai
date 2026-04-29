import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Heading } from '../components/ui';
import { formatSupabaseError } from '../lib/errors';
import { messages } from '../lib/messages';

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        navigate('/login');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [success, navigate]);

  const validate = (): string | null => {
    if (!newPassword || !confirmPassword) {
      return 'パスワードと確認用パスワードを入力してください。';
    }
    if (newPassword.length < 8) {
      return 'パスワードは8文字以上で入力してください。';
    }
    if (newPassword !== confirmPassword) {
      return 'パスワードと確認用パスワードが一致しません。';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(formatSupabaseError(updateError).message || messages.error.saveFailed);
        return;
      }

      setSuccess(true);
    } catch {
      setError(messages.error.unexpected);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
      <div className="bg-neutral-0 dark:bg-neutral-800 rounded-xl shadow-lg p-8 sm:p-10 max-w-md w-full">
        <div className="text-center mb-8">
          <Heading level={1} className="mb-2">
            パスワード再設定
          </Heading>
          <p className="text-sm text-neutral-500 dark:text-neutral-300 m-0">
            新しいパスワードを入力してください
          </p>
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400 flex items-center justify-center mx-auto mb-4">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
              パスワードを更新しました
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-300">
              ログイン画面に戻ります。
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <ErrorBanner message={error} className="mb-4" />
            )}

            <Input
              id="newPassword"
              label="新しいパスワード"
              type="password"
              placeholder="8文字以上のパスワード"
              value={newPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewPassword(e.target.value)
              }
              leftIcon={<Lock size={18} />}
              disabled={loading}
            />

            <Input
              id="confirmPassword"
              label="確認用パスワード"
              type="password"
              placeholder="パスワードを再入力"
              value={confirmPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setConfirmPassword(e.target.value)
              }
              leftIcon={<Lock size={18} />}
              disabled={loading}
            />

            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
              {loading ? '更新中...' : 'パスワードを更新する'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
