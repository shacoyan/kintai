import type { Project, ProjectStatus } from '../../types';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';

export interface ProjectCardProps {
  project: Project;
  onClick?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** project.store_id -> store_name 解決 (null=全社) */
  storeName?: string;
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '稼働中',
  archived: 'アーカイブ',
};

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  active: 'success',
  archived: 'neutral',
};

const MAX_DESC_LENGTH = 100;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

export function ProjectCard({
  project,
  onClick,
  onArchive,
  onUnarchive,
  onDelete,
  canEdit = false,
  canDelete = false,
  storeName,
}: ProjectCardProps): JSX.Element {
  const isClickable = canEdit || !!onClick;
  const isArchived = project.status === 'archived';
  const storeLabel = project.store_id === null ? '全社' : storeName ?? '店舗';

  const handleCardClick = () => {
    if (isClickable && onClick) onClick();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable || !onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm motion-safe:transition-shadow ${
        isClickable ? 'cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none' : ''
      }`}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `プロジェクト: ${project.name}` : undefined}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-body font-semibold text-neutral-900 dark:text-neutral-50 leading-snug truncate">
              {project.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-neutral-500 dark:text-neutral-400">
              <span>{storeLabel}</span>
              <span aria-hidden="true">·</span>
              <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
            </div>
          </div>
        </div>

        {project.description && (
          <p className="mt-2 text-body-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-line">
            {truncate(project.description, MAX_DESC_LENGTH)}
          </p>
        )}

        {(canEdit || canDelete) && (
          <div
            className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-700 flex items-center justify-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit && !isArchived && onArchive && (
              <Button variant="secondary" size="sm" onClick={onArchive} aria-label="アーカイブする">
                アーカイブ
              </Button>
            )}
            {canEdit && isArchived && onUnarchive && (
              <Button variant="secondary" size="sm" onClick={onUnarchive} aria-label="アーカイブ解除">
                アーカイブ解除
              </Button>
            )}
            {canDelete && onDelete && (
              <Button variant="danger" size="sm" onClick={onDelete} aria-label="削除">
                削除
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
