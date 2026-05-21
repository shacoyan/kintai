import { FolderKanban } from 'lucide-react';
import type { Project } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { ProjectCard } from './ProjectCard';

export interface ProjectListProps {
  projects: Project[];
  onProjectClick?: (project: Project) => void;
  onArchive?: (project: Project) => void;
  onUnarchive?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** store_id -> 店舗名 */
  storeNames?: Map<string, string>;
  emptyMessage?: string;
  renderItem?: (project: Project) => JSX.Element;
}

export function ProjectList(props: ProjectListProps): JSX.Element {
  const {
    projects,
    onProjectClick,
    onArchive,
    onUnarchive,
    onDelete,
    canEdit,
    canDelete,
    storeNames,
    emptyMessage,
    renderItem,
  } = props;

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban aria-hidden="true" />}
        title={emptyMessage ?? 'プロジェクトはありません'}
        description="新しいプロジェクトを作成してください。"
      />
    );
  }

  return (
    <div className="space-y-2">
      {projects.map((p) => {
        if (renderItem) {
          return <div key={p.id}>{renderItem(p)}</div>;
        }
        const storeName = p.store_id ? storeNames?.get(p.store_id) : undefined;
        return (
          <ProjectCard
            key={p.id}
            project={p}
            onClick={onProjectClick ? () => onProjectClick(p) : undefined}
            onArchive={onArchive ? () => onArchive(p) : undefined}
            onUnarchive={onUnarchive ? () => onUnarchive(p) : undefined}
            onDelete={onDelete ? () => onDelete(p) : undefined}
            canEdit={canEdit}
            canDelete={canDelete}
            storeName={storeName}
          />
        );
      })}
    </div>
  );
}
