// =============================================================================
// Phase 2 — 閲覧範囲設定 UI セクション（owner 専用）
// 設計書: .company/engineering/docs/2026-06-30-kintai-permissions-phase2-view-scope-ui.md §5.4 / §5.5
//
// 役割: owner(社長) が「店長(manager) が勤怠 / シフト / シフト希望をどの範囲で閲覧できるか」を
//   全店(tenant) / 自店のみ(own_stores) で切替える。設定は set_view_scope RPC で書込み、
//   Phase1 の SELECT RLS が即座に強制する（UI だけの権限にしない）。
//
// 第一弾スコープ（厳守）: 3 domain（attendance/shift/shift_preference）× manager のみ。
//   日報 / 月報 / タスク / 売上は RLS 未強制のため出さない（効かない偽トグル厳禁）。
// =============================================================================

import React, { useState } from 'react';
import { useCan } from '../../lib/permissions/useCan';
import { useToast } from '../../contexts/ToastContext';
import { formatSupabaseError } from '../../lib/errors';
import { Heading } from '../ui/Heading';
import {
  useViewScopes,
  VIEW_DOMAINS,
  type ViewDomain,
  type ViewScope,
} from '../../hooks/useViewScopes';

interface AdminViewScopeSettingsProps {
  tenantId: string;
}

const DOMAIN_LABELS: Record<ViewDomain, string> = {
  attendance: '勤怠',
  shift: 'シフト',
  shift_preference: 'シフト希望',
};

const SCOPE_OPTIONS: { value: ViewScope; label: string }[] = [
  { value: 'tenant', label: '全店' },
  { value: 'own_stores', label: '自店のみ' },
];

export const AdminViewScopeSettings: React.FC<AdminViewScopeSettingsProps> = ({ tenantId }) => {
  const can = useCan();
  const { showToast } = useToast();
  const { scopes, loading, error, setScope } = useViewScopes(tenantId);

  // どの domain を更新中か（更新中はそのグループを disabled）。
  const [savingDomain, setSavingDomain] = useState<ViewDomain | null>(null);

  // C27 manageViewScopes（書込は set_view_scope RPC + Phase1 RLS で別途強制）。owner 以外は描画しない。
  if (!can('manageViewScopes')) {
    return null;
  }

  const handleChange = async (domain: ViewDomain, next: ViewScope) => {
    if (next === scopes[domain]) return;
    setSavingDomain(domain);
    try {
      await setScope(domain, next);
      showToast('閲覧範囲を更新しました', 'success');
    } catch (e) {
      // エラー全文表示（substring/length カット等の短縮一切禁止）。
      showToast(formatSupabaseError(e).message, 'error');
    } finally {
      setSavingDomain(null);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-800 rounded-lg shadow p-4 border border-stone-100 dark:border-stone-700">
      <Heading level={2} as="h3" className="mb-2">
        閲覧範囲設定
      </Heading>

      <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed mb-1">
        店長が閲覧できる範囲を設定します。社長(オーナー)は常に全店を閲覧できます。
      </p>
      <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed mb-4">
        シフトを「自店のみ」にすると、一般スタッフのシフト閲覧も自店に縮退します。
      </p>

      {error && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-800/30 border border-red-100 dark:border-red-700 rounded-md px-3 py-2">
          {error.message}
        </div>
      )}

      <div className="space-y-4">
        {VIEW_DOMAINS.map((domain) => {
          const current = scopes[domain];
          const groupDisabled = loading || savingDomain !== null;
          const groupLabel = `${DOMAIN_LABELS[domain]}の閲覧範囲`;
          return (
            <div
              key={domain}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                {DOMAIN_LABELS[domain]}
              </span>
              <div
                role="radiogroup"
                aria-label={groupLabel}
                className="inline-flex rounded-md border border-stone-300 dark:border-stone-600 overflow-hidden"
              >
                {SCOPE_OPTIONS.map((opt) => {
                  const selected = current === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${DOMAIN_LABELS[domain]}: ${opt.label}`}
                      disabled={groupDisabled}
                      onClick={() => handleChange(domain, opt.value)}
                      className={[
                        'px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed',
                        selected
                          ? 'bg-blue-600 text-white dark:bg-blue-500'
                          : 'bg-white text-stone-700 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700',
                      ].join(' ')}
                    >
                      {/* 選択状態を色だけに依存させない（テキストマーカー併用） */}
                      <span aria-hidden="true" className="mr-1">
                        {selected ? '●' : '○'}
                      </span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
