/**
 * 招待URL `/join?code=XXX` ルートのページコンポーネント。
 *
 * Phase 3: 本実装。
 *  - 未ログイン時: pending_join_code を localStorage 保存して /login へリダイレクト
 *  - ログイン済 + テナント未参加 / 別テナント所属:
 *      tenants 行 lookup → tenant 名 + 配属予定店舗を表示
 *      → display_name 入力 → joinTenantViaUrl → setCurrentTenant + /dashboard 遷移
 *  - 既メンバー / 期限切れ / 上限到達 / 無効コード をそれぞれ識別表示
 *
 * 設計書: .company/engineering/docs/2026-05-10-kintai-invite-url-techdesign.md §5.3 / §6.4
 *         .company/engineering/docs/2026-05-12-kintai-invite-url-per-store-techdesign.md §15.1 (P1-B)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../contexts/TenantContext';
import { Heading, PageLoader, Button, Input, ErrorBanner } from '../components/ui';
import {
  parseInviteCodeFromUrl,
  setPendingJoinCode,
  clearPendingJoinCode,
} from '../lib/inviteUrl';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { formatSupabaseError } from '../lib/errors';
import { messages } from '../lib/messages';
import type { Tenant } from '../types';

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ok';
      tenant: Pick<Tenant, 'id' | 'name'>;
      stores: { id: string; name: string }[];
      alreadyMember: boolean;
      // 2026-05-12: tenant_invite_code_stores SELECT が RLS で 0 行 or error の場合 true。
      // true かつ stores.length === 0 のとき「加入後に確認できます」文言を表示する。
      storeRowsBlocked: boolean;
    }
  | { status: 'expired' }
  | { status: 'maxUsesReached' }
  | { status: 'notFound' }
  | { status: 'error'; message: string };

// 2026-06-14 #3: preview_invite RPC（SECURITY DEFINER）の返り 1 行。
// code 文字列・owner_id・revoked_at 値は返らない（列挙防止）。
interface InvitePreviewRow {
  tenant_id: string;
  tenant_name: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  is_valid: boolean;
  reason: string;
  stores: { id: string; name: string }[] | null;
}

export function JoinPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const {
    tenants,
    joinTenantViaUrl,
    setCurrentTenant,
    fetchTenants,
  } = useTenant();

  const code = useMemo(
    () =>
      parseInviteCodeFromUrl(
        typeof window !== 'undefined' ? window.location.search : ''
      ),
    []
  );

  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [displayName, setDisplayName] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 未ログイン時: pending_join_code 保存 + /login redirect
  useEffect(() => {
    if (authLoading) return;
    if (user != null) return;
    if (!code) return;
    setPendingJoinCode(code);
    navigate('/login', {
      replace: true,
      state: { from: { pathname: '/join', search: window.location.search } },
    });
  }, [authLoading, user, code, navigate]);

  // unmount 時に pending_join_code を掃除（成功 / エラー確定どちらでも）
  useEffect(() => {
    return () => {
      // 未ログイン → /login redirect 中は keep される。
      // JoinPage 表示中に手動で別ページに遷移したケースのゴミ掃除。
      if (user != null) {
        clearPendingJoinCode();
      }
    };
  }, [user]);

  // ログイン済時: tenants 行 lookup → preview 構築
  useEffect(() => {
    if (authLoading) return;
    if (user == null) return;
    if (!code) {
      setPreview({ status: 'idle' });
      return;
    }

    let cancelled = false;
    (async () => {
      setPreview({ status: 'loading' });
      try {
        // 2026-06-14 #3 列挙脆弱性修正: tenant_invite_codes / tenant_invite_code_stores の
        // 直 SELECT（全テナント列挙可能）を廃止し、SECURITY DEFINER RPC preview_invite に集約。
        // RPC は code 完全一致 1 件のみ評価し、code 文字列・owner_id・revoked_at 値は返さない。
        // 配属店舗(stores)も RPC が返すため storeRowsBlocked は不要（常に false 互換維持）。
        const { data, error } = await supabase.rpc('preview_invite', {
          p_code: code,
        });

        if (cancelled) return;

        if (error) {
          logger.error('invite preview rpc failed:', formatSupabaseError(error));
          setPreview({
            status: 'error',
            message: formatSupabaseError(error).message,
          });
          return;
        }

        // RETURNS TABLE は配列で返る。
        const row = (Array.isArray(data) ? data[0] : data) as
          | InvitePreviewRow
          | null
          | undefined;

        if (!row || row.reason === 'not_found') {
          setPreview({ status: 'notFound' });
          return;
        }
        if (row.reason === 'revoked') {
          // revoked は存在を隠して notFound 扱い。
          setPreview({ status: 'notFound' });
          return;
        }
        if (row.reason === 'expired') {
          setPreview({ status: 'expired' });
          return;
        }
        if (row.reason === 'max_uses_reached') {
          setPreview({ status: 'maxUsesReached' });
          return;
        }

        const stores: { id: string; name: string }[] = Array.isArray(row.stores)
          ? row.stores
              .map((s: unknown) => {
                const obj = s as { id?: string; name?: string } | null;
                return obj && obj.id && obj.name
                  ? { id: obj.id, name: obj.name }
                  : null;
              })
              .filter((s): s is { id: string; name: string } => s != null)
          : [];

        const alreadyMember = tenants.some((t) => t.id === row.tenant_id);

        setPreview({
          status: 'ok',
          tenant: { id: row.tenant_id, name: row.tenant_name },
          stores,
          alreadyMember,
          storeRowsBlocked: false,
        });
      } catch (e) {
        if (cancelled) return;
        logger.error('invite preview failed:', formatSupabaseError(e));
        setPreview({
          status: 'error',
          message: formatSupabaseError(e).message,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, code, tenants]);

  const handleJoin = useCallback(async () => {
    if (!code) return;
    if (!displayName.trim()) {
      setSubmitError(messages.validation.required('表示名'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tenant = await joinTenantViaUrl(code, displayName.trim());
      setCurrentTenant(tenant);
      await fetchTenants();
      clearPendingJoinCode();
      navigate('/', { replace: true });
    } catch (e) {
      const msg = formatSupabaseError(e).message || messages.invite.joinFailed;
      if (msg.includes('すでに')) {
        setPreview((prev) =>
          prev.status === 'ok' ? { ...prev, alreadyMember: true } : prev
        );
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    code,
    displayName,
    joinTenantViaUrl,
    setCurrentTenant,
    fetchTenants,
    navigate,
  ]);

  if (authLoading) {
    return <PageLoader variant="screen" />;
  }

  if (!code) {
    return (
      <CenteredCard>
        <Heading level={2}>{messages.invite.codeNotFound}</Heading>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          有効な招待リンクからアクセスしてください。
        </p>
        <BackHomeLink />
      </CenteredCard>
    );
  }

  if (user == null) {
    return <PageLoader variant="screen" />;
  }

  if (preview.status === 'idle' || preview.status === 'loading') {
    return <PageLoader variant="screen" label="招待先を確認しています…" />;
  }

  if (preview.status === 'expired') {
    return (
      <CenteredCard>
        <Heading level={2}>{messages.invite.codeExpired}</Heading>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          招待元の管理者にお問い合わせください。
        </p>
        <BackHomeLink />
      </CenteredCard>
    );
  }

  if (preview.status === 'maxUsesReached') {
    return (
      <CenteredCard>
        <Heading level={2}>{messages.invite.codeMaxUsesReached}</Heading>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          招待元の管理者にお問い合わせください。
        </p>
        <BackHomeLink />
      </CenteredCard>
    );
  }

  if (preview.status === 'notFound') {
    return (
      <CenteredCard>
        <Heading level={2}>{messages.invite.codeInvalid}</Heading>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          招待リンクが無効か、有効期限が切れている可能性があります。
        </p>
        <p className="font-mono text-xs text-stone-400 dark:text-stone-500">
          コード: {code}
        </p>
        <BackHomeLink />
      </CenteredCard>
    );
  }

  if (preview.status === 'error') {
    return (
      <CenteredCard>
        <Heading level={2}>読み込みに失敗しました</Heading>
        <ErrorBanner message={preview.message} />
        <BackHomeLink />
      </CenteredCard>
    );
  }

  const { tenant, stores, alreadyMember, storeRowsBlocked } = preview;

  if (alreadyMember) {
    return (
      <CenteredCard>
        <Heading level={2}>{messages.invite.alreadyMember}</Heading>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {tenant.name}
        </p>
        <Link
          to="/"
          className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.04)] motion-safe:transition-all duration-150 ease-out hover:bg-blue-700 hover:shadow-[0_4px_12px_rgb(0_0_0/0.08)] hover:-translate-y-px active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          {messages.invite.goDashboardButton}
        </Link>
      </CenteredCard>
    );
  }

  const assignedHiddenLabel = messages.invite.assignedStoresHiddenUntilJoin;

  return (
    <CenteredCard>
      <Heading level={2}>{messages.invite.joinTitle(tenant.name)}</Heading>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        {messages.invite.joinDescription}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleJoin();
        }}
        className="flex w-full flex-col gap-4"
      >
        <Input
          id="join-display-name"
          label="表示名"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例: たろう"
          maxLength={30}
          disabled={submitting}
          hint="シフト表・出退勤表で他のメンバーに表示されます。後から変更できます。"
        />

        {stores.length > 0 ? (
          <section className="rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/60 p-3">
            <div className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-200">
              {messages.invite.assignedStoresLabel}
            </div>
            <ul className="text-sm text-stone-700 dark:text-stone-200 space-y-0.5">
              {stores.map((s, idx) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span aria-hidden="true">・</span>
                  <span>{s.name}</span>
                  {idx === 0 && (
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {messages.invite.primaryStoreSuffix}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : storeRowsBlocked ? (
          <p className="text-xs text-text-muted">{assignedHiddenLabel}</p>
        ) : null}

        {submitError && <ErrorBanner message={submitError} />}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-6 py-2.5 text-sm font-medium text-stone-700 motion-safe:transition-colors duration-150 ease-out hover:bg-stone-50 hover:border-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            {messages.invite.cancelButton}
          </Link>
          <Button type="submit" variant="primary" loading={submitting}>
            {messages.invite.joinButton}
          </Button>
        </div>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 sm:p-8 shadow-[0_12px_28px_rgba(0,0,0,0.08)] flex flex-col items-stretch gap-5">
        {children}
      </div>
    </div>
  );
}

function BackHomeLink(): JSX.Element {
  return (
    <Link
      to="/"
      className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.04)] motion-safe:transition-all duration-150 ease-out hover:bg-blue-700 hover:shadow-[0_4px_12px_rgb(0_0_0/0.08)] hover:-translate-y-px active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400"
    >
      {messages.invite.backHomeButton}
    </Link>
  );
}

export default JoinPage;
