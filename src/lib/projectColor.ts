/**
 * projectColor — プロジェクト ID から安定的に色を決定するユーティリティ。
 *
 * - 同じ projectId は常に同じ色を返す (deterministic hash)
 * - 8 色パレット (blue / emerald / orange / purple / pink / cyan / amber / indigo)
 * - null/undefined (プロジェクトなし) は neutral (stone) を返す
 *
 * 用途:
 *   - KanbanCard 左 border + プロジェクト名 chip の色決定
 *   - 将来の他カンバン UI でも使い回せる純関数
 *
 * Tailwind JIT 対策: クラス文字列はリテラルで列挙し、purge から漏れないようにする。
 */

export interface ProjectColorClasses {
  /** chip 背景 (light + dark) */
  bg: string;
  /** chip テキスト (light + dark) */
  text: string;
  /** カード左 border (border-l-[3px] と併用) */
  border: string;
}

const PROJECT_COLORS: ProjectColorClasses[] = [
  {
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-500',
  },
  {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-500',
  },
  {
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-500',
  },
  {
    bg: 'bg-purple-100 dark:bg-purple-900/40',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-500',
  },
  {
    bg: 'bg-pink-100 dark:bg-pink-900/40',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-500',
  },
  {
    bg: 'bg-cyan-100 dark:bg-cyan-900/40',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-500',
  },
  {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-500',
  },
  {
    bg: 'bg-indigo-100 dark:bg-indigo-900/40',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-500',
  },
];

const NEUTRAL_COLOR: ProjectColorClasses = {
  bg: 'bg-stone-100 dark:bg-stone-800',
  text: 'text-stone-600 dark:text-stone-300',
  border: 'border-stone-300 dark:border-stone-600',
};

/**
 * projectId から安定的に色クラスを取得する。
 *
 * @param projectId プロジェクト ID (UUID 等)。null/undefined の場合は neutral を返す。
 * @returns Tailwind クラス文字列のセット (bg / text / border)
 */
export function getProjectColor(
  projectId: string | null | undefined,
): ProjectColorClasses {
  if (!projectId) {
    return NEUTRAL_COLOR;
  }
  // djb2 系の簡易 hash (安定 + 高速)。負数化対策に Math.abs。
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash << 5) - hash + projectId.charCodeAt(i);
    hash |= 0; // 32bit 化
  }
  const idx = Math.abs(hash) % PROJECT_COLORS.length;
  return PROJECT_COLORS[idx];
}
