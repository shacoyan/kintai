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
        containerClass: 'bg-success-100 text-success-800 ring-1 ring-success-300 dark:bg-success-900/40 dark:text-success-200 dark:ring-success-700',
      };
    case 'pending':
      return {
        tone: 'info',
        statusLabelJa: '申請中',
        containerClass: 'bg-info-100 text-info-800 ring-1 ring-info-300 dark:bg-info-900/40 dark:text-info-200 dark:ring-info-700',
      };
    case 'rejected':
      return {
        tone: 'danger',
        statusLabelJa: '却下',
        containerClass: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200 opacity-70 line-through decoration-from-font dark:bg-danger-900/30 dark:text-danger-200 dark:ring-danger-700',
      };
  }
}
