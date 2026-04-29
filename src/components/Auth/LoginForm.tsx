import { useState, type FormEvent, type MouseEvent } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ErrorBanner } from '../ui/ErrorBanner';
import { formatSupabaseError } from '../../lib/errors';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}

export const LoginForm = function LoginForm() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showResetForm, setShowResetForm] = useState<boolean>(false);
  const [resetEmail, setResetEmail] = useState<string>('');
  const [resetLoading, setResetLoading] = useState<boolean>(false);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        try {
          await signIn(email, password);
        } catch {
          setError(
            '登録しました。確認メールを送信した場合は、メール内のリンクをクリックしてからログインしてください。',
          );
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setResetSuccess(false);
    setResetLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        resetEmail,
        { redirectTo: window.location.origin + '/reset-password' }
      );
      if (resetError) {
        throw resetError;
      }
      setResetSuccess(true);
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleGoogleLogin = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // TODO Phase 3: signInWithOAuth({ provider: 'google' })
  };

  if (showResetForm) {
    return (
      <form
        onSubmit={handleResetSubmit}
        aria-busy={resetLoading || undefined}
        className="flex flex-col gap-4"
      >
        {error ? <ErrorBanner message={error} /> : null}

        {resetSuccess ? (
          <div className="rounded-md bg-success-50 dark:bg-success-900/30 p-3 text-sm text-success-700 dark:text-success-200">
            パスワードリセットのメールを送信しました。メール内のリンクからパスワードを再設定してください。
          </div>
        ) : null}

        <p className="text-sm text-neutral-600">
          登録済みのメールアドレスを入力してください。パスワードリセット用のリンクをメールでお送りします。
        </p>

        <Input
          type="email"
          label="メールアドレス"
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
          required
          autoComplete="email"
          leftIcon={<Mail size={16} aria-hidden="true" />}
          placeholder="name@example.com"
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={resetLoading}
        >
          リセットメールを送信
        </Button>

        <button
          type="button"
          onClick={() => {
            setShowResetForm(false);
            setError(null);
            setResetSuccess(false);
          }}
          className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:hover:text-primary-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 rounded"
        >
          ログインに戻る
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={loading || undefined}
      className="flex flex-col gap-4"
    >
      {error ? <ErrorBanner message={error} /> : null}

      <Input
        type="email"
        label="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        leftIcon={<Mail size={16} aria-hidden="true" />}
        placeholder="name@example.com"
      />

      <Input
        type={showPassword ? 'text' : 'password'}
        label="パスワード"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete={isLogin ? 'current-password' : 'new-password'}
        leftIcon={<Lock size={16} aria-hidden="true" />}
        placeholder="••••••••"
        rightSlot={
          <button
            type="button"
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
            onClick={() => setShowPassword((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-200 motion-safe:transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
          >
            {showPassword ? (
              <EyeOff size={16} aria-hidden="true" />
            ) : (
              <Eye size={16} aria-hidden="true" />
            )}
          </button>
        }
      />

      {isLogin ? (
        <div className="flex items-center justify-between">
          <Checkbox label="このデバイスを記憶する" />
          <button
            type="button"
            onClick={() => setShowResetForm(true)}
            className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:hover:text-primary-300 hover:underline"
          >
            パスワードをお忘れですか？
          </button>
        </div>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={loading}
      >
        {isLogin ? 'ログイン' : '新規登録'}
      </Button>

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-neutral-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-neutral-50 px-3 text-xs text-neutral-500">
            または
          </span>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        fullWidth
        iconLeft={<GoogleIcon />}
        onClick={handleGoogleLogin}
      >
        Google でログイン
      </Button>

      <p className="mt-2 text-center text-sm text-neutral-600">
        {isLogin
          ? 'アカウントをお持ちでない方は'
          : 'すでにアカウントをお持ちの方は'}
        <button
          type="button"
          onClick={() => {
            setIsLogin((v) => !v);
            setError(null);
          }}
          className="ml-1 font-semibold text-primary-600 hover:text-primary-700 dark:hover:text-primary-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 rounded"
        >
          {isLogin ? '新規登録' : 'ログイン'}
        </button>
      </p>
    </form>
  );
};
