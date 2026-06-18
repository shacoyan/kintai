import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoginForm } from '../components/Auth/LoginForm';
import { BrandMark, PageLoader, Heading } from '../components/ui';
import { getPendingJoinCode } from '../lib/inviteUrl';

function HeroSection() {
  return (
    <section
      className="hidden lg:flex relative flex-col justify-between bg-stone-900 text-white overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="absolute left-12 top-0 bottom-0 w-px bg-white/10" />

      <div className="relative z-10 p-10 xl:p-14">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-white dark:bg-stone-900 flex items-center justify-center">
            <BrandMark size="md" color="#2563EB" />
          </div>
          <span className="text-[15px] font-semibold tracking-wide">kintai</span>
        </div>
      </div>

      <div className="relative z-10 px-10 xl:px-14 max-w-xl">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-blue-300 uppercase mb-6">
          Workforce Operations
        </p>
        <h1 className="font-serif text-[44px] xl:text-[52px] leading-tight font-bold mb-6">
          シフトと勤怠を、
          <br />
          静かに整える。
        </h1>
        <p className="text-[15px] leading-[1.8] text-white/70">
          複数店舗のシフト申請、出退勤、給与計算までを一つに。
          <br />
          業務に集中できる、端正な業務ツールです。
        </p>
      </div>

      <div className="relative z-10 p-10 xl:p-14 flex items-end justify-between text-[12px] text-white/50">
        <div className="space-y-1">
          <p>運営: NewWorld Inc.</p>
          <p>サポート: support@kintai.app</p>
        </div>
        <div className="text-right">
          <p className="tabular-nums">v2.4.0</p>
          <p>2026 © kintai</p>
        </div>
      </div>
    </section>
  );
}

export const LoginPage = function LoginPage() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return <PageLoader variant="screen" />;
  }

  if (user) {
    // 招待URL復帰: ログイン直前に保存された pending_join_code があれば /join へ戻す。
    // 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §3.5 / §5.5
    // localStorage 削除は JoinPage 側で「成功」or「挽回不能エラー」確定時に実行する。
    const pendingJoinCode = getPendingJoinCode();
    if (pendingJoinCode) {
      return <Navigate to={`/join?code=${encodeURIComponent(pendingJoinCode)}`} replace />;
    }
    // 認証ガードが state.from に元の遷移先を載せていれば、ログイン後そこへ戻す。
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[52%_48%] bg-stone-50 dark:bg-stone-950">
      <HeroSection />

      <section className="flex flex-col items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden mb-10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-blue-600 dark:bg-blue-500 flex items-center justify-center">
              <BrandMark size="sm" color="#ffffff" />
            </div>
            <span className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">kintai</span>
          </div>

          <Heading level={1} className="leading-tight mb-2">
            ログイン
          </Heading>
          <p className="text-sm text-stone-500 dark:text-stone-300 mb-8">
            登録済みのメールアドレスでサインインしてください。
          </p>

          <LoginForm />

          <div className="mt-12 pt-6 border-t border-stone-200 dark:border-stone-700 flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-300">
            <div className="flex items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>暗号化通信</span>
            </div>
            <span className="tabular-nums">JP-DC1 / 99.95% Uptime</span>
          </div>
        </div>
      </section>
    </main>
  );
};
