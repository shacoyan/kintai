import type { Project, TaskStatus } from '../../types';
import { TASK_STATUS_LABELS } from '../../types';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import type { MemberOption, StoreOption, TaskFilterValue } from './types';

export interface TaskFilterBarProps {
  value: TaskFilterValue;
  onChange: (next: TaskFilterValue) => void;
  projects: Project[];
  members: MemberOption[];
  stores?: StoreOption[];
  /** 店舗フィルタを表示するか (バイトは固定なので非表示) */
  showStoreFilter?: boolean;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: TASK_STATUS_LABELS.todo },
  { value: 'in_progress', label: TASK_STATUS_LABELS.in_progress },
  { value: 'done', label: TASK_STATUS_LABELS.done },
  { value: 'cancelled', label: TASK_STATUS_LABELS.cancelled },
];

/**
 * ステータスは複数選択 (チェックボックス群)。
 * プロジェクト・担当者・店舗は単一 Select。
 * リセットボタンで全クリア。
 */
export function TaskFilterBar(props: TaskFilterBarProps): JSX.Element {
  const { value, onChange, projects, members, stores = [], showStoreFilter = true } = props;
  const selectedStatuses = value.status ?? [];

  const toggleStatus = (s: TaskStatus) => {
    const has = selectedStatuses.includes(s);
    const next = has ? selectedStatuses.filter((x) => x !== s) : [...selectedStatuses, s];
    onChange({ ...value, status: next.length === 0 ? undefined : next });
  };

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    onChange({ ...value, projectId: v === '' ? undefined : v });
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    onChange({ ...value, assigneeUserId: v === '' ? undefined : v });
  };

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === '') {
      onChange({ ...value, storeId: undefined });
    } else if (v === '__global__') {
      onChange({ ...value, storeId: null });
    } else {
      onChange({ ...value, storeId: v });
    }
  };

  const handleReset = () => {
    onChange({});
  };

  const hasAnyFilter =
    (value.status && value.status.length > 0) ||
    !!value.projectId ||
    !!value.assigneeUserId ||
    value.storeId !== undefined;

  const storeSelectValue =
    value.storeId === undefined ? '' : value.storeId === null ? '__global__' : value.storeId;

  return (
    <div className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg p-3 space-y-3">
      {/* ステータス (multi) */}
      <div>
        <span className="block text-sm font-semibold text-stone-700 dark:text-stone-200 mb-1">
          ステータス
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ステータス">
          {STATUS_OPTIONS.map((opt) => {
            const active = selectedStatuses.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleStatus(opt.value)}
                aria-pressed={active}
                className={`px-3 h-9 rounded-md text-sm font-medium border motion-safe:transition-colors focus-ring ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500'
                    : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-600 dark:hover:bg-stone-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* セレクト群 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select
          label="プロジェクト"
          value={value.projectId ?? ''}
          onChange={handleProjectChange}
          placeholder="すべて"
        >
          <option value="">すべて</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <Select
          label="担当者"
          value={value.assigneeUserId ?? ''}
          onChange={handleAssigneeChange}
          placeholder="すべて"
        >
          <option value="">すべて</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        {showStoreFilter && (
          <Select
            label="店舗"
            value={storeSelectValue}
            onChange={handleStoreChange}
            placeholder="すべて"
          >
            <option value="">すべて</option>
            <option value="__global__">全社 (店舗指定なし)</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* リセット */}
      <div className="flex justify-end">
        <Button
          variant="tertiary"
          size="sm"
          onClick={handleReset}
          disabled={!hasAnyFilter}
          aria-label="フィルタをリセット"
        >
          リセット
        </Button>
      </div>
    </div>
  );
}
