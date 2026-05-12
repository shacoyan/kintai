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

interface InvitePreviewRow {
  id: string;
  tenant_id: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  revoked_at: string | null;
  tenants: {
    id: string;
    name: string;
    deleted_at: string | null;
  } | null;
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
        // 2026-05-12: per-store invite URL 対応。
        // 旧: tenants.invite_code 直接 lookup
        // 新: tenant_invite_codes lookup + tenants embed
        const { data, error } = await supabase
          .from('tenant_invite_codes')
          .select(
            'id, tenant_id, expires_at, max_uses, used_count, revoked_at, tenants!inner(id, name, deleted_at)'
          )
          .eq('code', code)
          .is('revoked_at', null)
          .is('tenants.deleted_at', null)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          logger.error('invite preview query failed:', formatSupabaseError(error));
          setPreview({
            status: 'error',
            message: formatSupabaseError(error).message,
          });
          return;
        }

        if (!data) {
          // v3 で見つからなければ即 notFound 確定 (v2 fallback は本 Loop では実装しない)。
          setPreview({ status: 'notFound' });
          return;
        }

        const row = data as unknown as InvitePreviewRow;
        const tenantRow = row.tenants;
        if (!tenantRow || tenantRow.deleted_at != null) {
          setPreview({ status: 'notFound' });
          return;
        }

        if (
          row.expires_at &&
          new Date(row.expires_at).getTime() < Date.now()
        ) {
          setPreview({ status: 'expired' });
          return;
        }
        if (
          row.max_uses != null &&
          row.used_count >= row.max_uses
        ) {
          setPreview({ status: 'maxUsesReached' });
          return;
        }

        // 配属予定店舗 lookup (tenant_invite_code_stores ベース)
        // 2026-05-12 P1-B: 未参加 user は RLS で中間表を見られないため、
        // storeErr 発生時のみ storeRowsBlocked=true で続行し、表示側でフォールバック文言を出す。
        // N=0 招待 (店舗ゼロ＝テナント加入のみ) は正常状態として storeRowsBlocked=false のまま扱う。
        const { data: storeRows, error: storeErr } = await supabase
          .from('tenant_invite_code_stores')
          .select('store_id, sort_order, stores(id, name)')
          .eq('invite_code_id', row.id)
          .order('sort_order');

        if (storeErr) {
          logger.error(
            'invite preview store lookup blocked (likely RLS):',
            formatSupabaseError(storeErr)
          );
        }

        const storeRowsBlocked = !!storeErr;

        const stores: { id: string; name: string }[] = Array.isArray(storeRows)
          ? storeRows
              .map((r: unknown) => {
                const obj = r as { stores?: { id: string; name: string } | null };
                return obj.stores ?? null;
              })
              .filter((s): s is { id: string; name: string } => s != null)
          : [];

        const alreadyMember = tenants.some((t) => t.id === tenantRow.id);

        setPreview({
          status: 'ok',
          tenant: { id: tenantRow.id, name: tenantRow.name },
          stores,
          alreadyMember,
          storeRowsBlocked,
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
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
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
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
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
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
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
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
          招待リンクが無効か、有効期限が切れている可能性があります。
        </p>
        <p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">
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
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
          {tenant.name}
        </p>
        <Link
          to="/"
          className="inline-flex w-full items-center justify-center rounded-lg bg-primary-600 dark:bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 dark:hover:bg-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
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
      <p className="text-sm text-neutral-500 dark:text-neutral-300">
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
          <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/40 p-3">
            <div className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {messages.invite.assignedStoresLabel}
            </div>
            <ul className="text-sm text-neutral-700 dark:text-neutral-200 space-y-0.5">
              {stores.map((s, idx) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span aria-hidden="true">・</span>
                  <span>{s.name}</span>
                  {idx === 0 && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-300">
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
            className="inline-flex items-center justify-center rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-6 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-200 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-100 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-8 shadow-md flex flex-col items-stretch gap-5">
        {children}
      </div>
    </div>
  );
}

function BackHomeLink(): JSX.Element {
  return (
    <Link
      to="/"
      className="inline-flex w-full items-center justify-center rounded-lg bg-primary-600 dark:bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 dark:hover:bg-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400"
    >
      {messages.invite.backHomeButton}
    </Link>
  );
}

export default JoinPage;
