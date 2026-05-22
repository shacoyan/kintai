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
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950 px-4 py-12">
      <div className="w-full max-w-md bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.08)] p-6 sm:p-8">
        <div className="text-center mb-8">
          <Heading level={1} className="mb-2">
            パスワード再設定
          </Heading>
          <p className="text-sm text-stone-500 dark:text-stone-300 m-0">
            新しいパスワードを入力してください
          </p>
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
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
            <p className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-2">
              パスワードを更新しました
            </p>
            <p className="text-sm text-stone-500 dark:text-stone-300">
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
