export type PreferenceBarTone = 'success' | 'info' | 'danger';

export interface PreferenceBarTheme {
  tone: PreferenceBarTone;
  containerClass: string;
  statusLabelJa: string;
}

export function getPreferenceBarTheme(status: 'pending' | 'approved' | 'rejected'): PreferenceBarTheme {
  switch (status) {
    case 'approved':
      return {
        tone: 'success',
        statusLabelJa: '承認済',
        containerClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-800/40 dark:text-emerald-100 dark:ring-emerald-700',
      };
    case 'pending':
      return {
        tone: 'info',
        statusLabelJa: '申請中',
        containerClass: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-800/40 dark:text-blue-100 dark:ring-blue-700',
      };
    case 'rejected':
      return {
        tone: 'danger',
        statusLabelJa: '却下',
        containerClass: 'bg-red-50 text-red-700 ring-1 ring-red-100 opacity-70 line-through decoration-from-font dark:bg-red-800/30 dark:text-red-100 dark:ring-red-700',
      };
  }
}
