import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Card, Heading, Input, Button, ErrorBanner } from '../ui';
import { useToast } from '../../contexts/ToastContext';
import type { UseStoreMonthlySettingsResult } from '../../hooks/useStoreMonthlySettings';
import type { StoreMonthlySettingsForm } from '../../lib/reports/types';

// =============================================================================
// StoreMonthlySettingsEditor — 月次マスタ編集（managerial のみ）（Loop E §5.3）
// -----------------------------------------------------------------------------
//   - 固定費6（社員給与/家賃/水光熱/通信/広告/その他固定販管費）＋ 売上目標 を編集。
//   - 取得＝親が渡す useStoreMonthlySettings の data でフォーム初期化。
//   - 保存＝settings.saveSettings(tenantId, form)（upsert + RETURNING・0件エラー化）。
//     成功後 onSaved() で親が月報を refetch（固定費・利益が即反映 §5.3 末尾）。
//   - 前月複写＝settings.copyFromPrevMonth(tenantId) でフォームにプリフィル
//     （保存はユーザーが押すまでしない）。前月無ければ info トースト。
//   - managerial のみ描画される前提（親が isManagerial で出し分け＝二層防御）。
//   - 全項目 Input type=number min=0。金額は円（万単位は使わない）。
// =============================================================================

const FIELD_DEFS: { key: keyof StoreMonthlySettingsForm; label: string }[] = [
  { key: 'fixed_payroll_employee', label: '社員給与（固定）' },
  { key: 'rent', label: '家賃' },
  { key: 'utilities', label: '水道光熱費' },
  { key: 'communication', label: '通信費' },
  { key: 'advertising', label: '広告宣伝費' },
  { key: 'other_sga_fixed', label: 'その他固定販管費' },
  { key: 'sales_target', label: '売上目標' },
];

const EMPTY_FORM: StoreMonthlySettingsForm = {
  fixed_payroll_employee: 0,
  rent: 0,
  utilities: 0,
  communication: 0,
  advertising: 0,
  other_sga_fixed: 0,
  sales_target: 0,
};

export interface StoreMonthlySettingsEditorProps {
  settings: UseStoreMonthlySettingsResult;
  tenantId: string | null;
  year: number;
  month: number;
  /** 保存成功後に呼ばれる（親が月報を reload）。 */
  onSaved?: () => void;
}

export const StoreMonthlySettingsEditor: React.FC<StoreMonthlySettingsEditorProps> = ({
  settings,
  tenantId,
  year,
  month,
  onSaved,
}) => {
  const { showToast } = useToast();
  const { data, loading, error, saving, saveSettings, copyFromPrevMonth, reload } = settings;
  const [form, setForm] = useState<StoreMonthlySettingsForm>(EMPTY_FORM);

  // 取得値（または年月切替で null）に合わせてフォームを初期化する。
  useEffect(() => {
    if (data) {
      setForm({
        fixed_payroll_employee: data.fixed_payroll_employee,
        rent: data.rent,
        utilities: data.utilities,
        communication: data.communication,
        advertising: data.advertising,
        other_sga_fixed: data.other_sga_fixed,
        sales_target: data.sales_target,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [data, year, month]);

  const setField = (key: keyof StoreMonthlySettingsForm, raw: string) => {
    const n = Math.max(0, Math.trunc(Number(raw)) || 0);
    setForm((prev) => ({ ...prev, [key]: n }));
  };

  const handleSave = async () => {
    if (!tenantId) {
      showToast('テナントが未確定のため保存できません', 'error');
      return;
    }
    try {
      await saveSettings(tenantId, form);
      showToast('月次マスタを保存しました', 'success');
      onSaved?.();
    } catch (err) {
      // hook は全文メッセージで rethrow → throw された err を全文トースト（stale な
      // settings.error は読まない／短縮禁止・P2-4）。
      showToast(
        err instanceof Error ? err.message : '月次マスタの保存に失敗しました',
        'error',
      );
    }
  };

  const handleCopyPrev = async () => {
    if (!tenantId) {
      showToast('テナントが未確定です', 'error');
      return;
    }
    try {
      const prev = await copyFromPrevMonth(tenantId);
      if (!prev) {
        showToast('前月のマスタがありません', 'info');
        return;
      }
      setForm(prev);
      showToast('前月のマスタを読み込みました（保存で確定）', 'info');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '前月マスタの取得に失敗しました',
        'error',
      );
    }
  };

  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading level={4}>月次マスタ編集</Heading>
          <Button
            variant="tertiary"
            size="sm"
            onClick={handleCopyPrev}
            disabled={saving || loading}
            iconLeft={<Copy className="w-4 h-4" aria-hidden />}
          >
            前月から複写
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onRetry={reload} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELD_DEFS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type="number"
              min={0}
              inputMode="numeric"
              value={String(form[f.key])}
              disabled={saving}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!tenantId}>
            保存
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default StoreMonthlySettingsEditor;
