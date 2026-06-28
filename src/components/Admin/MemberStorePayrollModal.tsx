import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, RotateCcw, Store as StoreIcon } from 'lucide-react';
import { useMemberStorePayrolls } from '../../hooks/useMemberStorePayrolls';
import { useCan } from '../../lib/permissions/useCan';
import { useStoreContext } from '../../contexts/StoreContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatSupabaseError } from '../../lib/errors';
import type { MemberStorePayroll, Store, StoreMember, TenantMember } from '../../types';
import { Badge } from '../ui/Badge';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface MemberStorePayrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  member: TenantMember | null;
  members: TenantMember[];
}

type RowState = {
  storeId: string;
  storeName: string;
  pay_type: 'hourly' | 'monthly';
  hourly_rate: string;
  monthly_salary: string;
  night_shift_rate_multiplier: string;
  source: 'store_override' | 'member_default';
  dirty: boolean;
};

const buildPayrollKey = (userId: string, storeId: string) => `${userId}:${storeId}`;

const toInputValue = (value: number | null | undefined) => (value == null ? '' : String(value));

export function MemberStorePayrollModal({
  isOpen,
  onClose,
  tenantId,
  member,
  members,
}: MemberStorePayrollModalProps) {
  const can = useCan();
  const { stores } = useStoreContext();
  const { showToast } = useToast();
  const {
    fetchMemberStorePayrolls,
    getMemberStoreRate,
    upsertMemberStorePayroll,
    deleteMemberStorePayroll,
  } = useMemberStorePayrolls(tenantId);

  const [rows, setRows] = useState<RowState[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storeIds, setStoreIds] = useState<string[]>([]);

  // C12 editMemberStorePayroll（給与は VIEW089 + RLS で別途強制）。挙動不変。
  const canEdit = can('editMemberStorePayroll');
  const dirtyCount = rows.filter((row) => row.dirty).length;

  const attachedStores = useMemo(
    () => stores.filter((store) => storeIds.includes(store.id)),
    [stores, storeIds],
  );

  const buildRows = useCallback(
    (targetMember: TenantMember, targetStores: Store[], payrollsMap?: Map<string, MemberStorePayroll>) =>
      targetStores.map((store) => {
        const override = payrollsMap?.get(buildPayrollKey(targetMember.user_id, store.id));
        const rate = override
          ? {
              pay_type: override.pay_type,
              hourly_rate: override.hourly_rate,
              monthly_salary: override.monthly_salary,
              night_shift_rate_multiplier: override.night_shift_rate_multiplier,
              source: 'store_override' as const,
            }
          : getMemberStoreRate(targetMember.user_id, store.id, members);

        return {
          storeId: store.id,
          storeName: store.name,
          pay_type: rate.pay_type,
          hourly_rate: toInputValue(rate.hourly_rate),
          monthly_salary: toInputValue(rate.monthly_salary),
          night_shift_rate_multiplier: String(rate.night_shift_rate_multiplier ?? 1.25),
          source: rate.source,
          dirty: false,
        };
      }),
    [getMemberStoreRate, members],
  );

  const reload = useCallback(async () => {
    if (!isOpen || !member) return;

    setLoading(true);
    try {
      const [payrollsMap, storeMemberResult] = await Promise.all([
        fetchMemberStorePayrolls(),
        supabase.from('store_members').select('*').eq('member_id', member.id),
      ]);

      if (storeMemberResult.error) throw storeMemberResult.error;

      const attachedStoreIds = ((storeMemberResult.data as StoreMember[]) ?? []).map((row) => row.store_id);
      setStoreIds(attachedStoreIds);

      const targetStores = stores.filter((store) => attachedStoreIds.includes(store.id));
      setRows(buildRows(member, targetStores, payrollsMap));
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [buildRows, fetchMemberStorePayrolls, isOpen, member, showToast, stores]);

  useEffect(() => {
    if (!isOpen) {
      setRows([]);
      setStoreIds([]);
      return;
    }
    void reload();
  }, [isOpen, reload]);

  useEffect(() => {
    if (!isOpen || !member || storeIds.length === 0) return;
    setRows((current) => {
      if (current.length > 0) return current;
      return buildRows(member, attachedStores);
    });
  }, [attachedStores, buildRows, isOpen, member, storeIds.length]);

  const updateRow = (storeId: string, patch: Partial<Omit<RowState, 'storeId' | 'storeName'>>) => {
    setRows((current) =>
      current.map((row) =>
        row.storeId === storeId
          ? {
              ...row,
              ...patch,
              dirty: true,
            }
          : row,
      ),
    );
  };

  const handleReset = async (row: RowState) => {
    if (!member || !canEdit) return;

    setSaving(true);
    try {
      await deleteMemberStorePayroll(member.user_id, row.storeId, tenantId);
      const payrollsMap = await fetchMemberStorePayrolls();
      setRows(buildRows(member, attachedStores, payrollsMap));
      showToast('店舗別人件費を既定値に戻しました', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    if (!member || !canEdit) return;

    setSaving(true);
    try {
      for (const row of rows.filter((item) => item.dirty)) {
        await upsertMemberStorePayroll({
          tenant_id: tenantId,
          user_id: member.user_id,
          store_id: row.storeId,
          pay_type: row.pay_type,
          hourly_rate: row.pay_type === 'hourly' ? Number(row.hourly_rate) || null : null,
          monthly_salary: row.pay_type === 'monthly' ? Number(row.monthly_salary) || null : null,
          night_shift_rate_multiplier: Number(row.night_shift_rate_multiplier) || 1.25,
        });
      }
      showToast('店舗別人件費を保存しました', 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!member) return null;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="店舗別人件費"
      description={`${member.display_name} さんの所属店舗ごとの給与設定`}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {!canEdit ? (
            <p className="text-xs text-orange-700 dark:text-orange-300">権限がありません</p>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-300">
              変更 <span className="tabular-nums">{dirtyCount}</span> 件
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveAll}
              disabled={!canEdit || dirtyCount === 0 || saving || loading}
              loading={saving}
            >
              すべて保存
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-300">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-300">所属店舗がありません</div>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.storeId} className="border-b border-stone-200 py-4 last:border-b-0 dark:border-stone-700">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <StoreIcon className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
                    <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {row.storeName}
                    </p>
                  </div>
                  {row.source === 'store_override' ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                      onClick={() => handleReset(row)}
                      disabled={!canEdit || saving}
                      className="shrink-0"
                    >
                      既定値に戻す
                    </Button>
                  ) : (
                    <Badge
                      tone="neutral"
                      icon={<Building2 className="h-3 w-3" />}
                      className="shrink-0 bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    >
                      既定値使用中
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-300">給与区分</p>
                    <div className="inline-flex h-8 rounded-[4px] overflow-hidden border border-stone-200 dark:border-stone-600">
                      <button
                        type="button"
                        onClick={() => updateRow(row.storeId, { pay_type: 'hourly' })}
                        disabled={!canEdit || saving}
                        className={`px-3 py-1 text-xs font-medium motion-safe:transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          row.pay_type === 'hourly'
                            ? 'bg-blue-600 text-white dark:bg-blue-500'
                            : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
                        }`}
                        aria-label={`${row.storeName} の給与区分を時給にする`}
                      >
                        時給
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRow(row.storeId, { pay_type: 'monthly' })}
                        disabled={!canEdit || saving}
                        className={`px-3 py-1 text-xs font-medium motion-safe:transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          row.pay_type === 'monthly'
                            ? 'bg-blue-600 text-white dark:bg-blue-500'
                            : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
                        }`}
                        aria-label={`${row.storeName} の給与区分を月給にする`}
                      >
                        月給
                      </button>
                    </div>
                  </div>

                  {row.pay_type === 'hourly' ? (
                    <div className="w-32">
                      <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-300">時給</p>
                      <Input
                        type="number"
                        value={row.hourly_rate}
                        onChange={(event) => updateRow(row.storeId, { hourly_rate: event.target.value })}
                        min="0"
                        step="50"
                        size="sm"
                        disabled={!canEdit || saving}
                        aria-label={`${row.storeName} の時給`}
                        className="tabular-nums"
                        rightSlot={<span className="text-xs text-stone-400 dark:text-stone-500">円/h</span>}
                      />
                    </div>
                  ) : (
                    <div className="w-36">
                      <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-300">月給</p>
                      <Input
                        type="number"
                        value={row.monthly_salary}
                        onChange={(event) => updateRow(row.storeId, { monthly_salary: event.target.value })}
                        min="0"
                        step="10000"
                        size="sm"
                        disabled={!canEdit || saving}
                        aria-label={`${row.storeName} の月給`}
                        className="tabular-nums"
                        rightSlot={<span className="text-xs text-stone-400 dark:text-stone-500">円/月</span>}
                      />
                    </div>
                  )}

                  <div className="w-24">
                    <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-300">深夜割増</p>
                    <Input
                      type="number"
                      value={row.night_shift_rate_multiplier}
                      onChange={(event) => updateRow(row.storeId, { night_shift_rate_multiplier: event.target.value })}
                      min="1"
                      max="2"
                      step="0.05"
                      size="sm"
                      disabled={!canEdit || saving}
                      aria-label={`${row.storeName} の深夜割増`}
                      className="tabular-nums"
                      rightSlot={<span className="text-xs text-stone-400 dark:text-stone-500">倍</span>}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
