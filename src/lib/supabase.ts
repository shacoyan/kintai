import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// E2E (Playwright) からセッション取得を公式 API 経由で行うための限定 export。
// production build では import.meta.env.DEV が false となり Vite が dead-code 除去するため
// バンドル/runtime には現れない。詳細: docs/2026-04-30-kintai-loop41-techdesign.md §3
if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.MODE === 'test')) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__kintai_supabase = supabase;
}
