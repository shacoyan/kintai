import { useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { CorrectionRequest } from '../types';
import { formatSupabaseError } from '../lib/errors';

function mapReviewErrorCode(error: unknown): string {
  const code = (error && typeof error === 'object' && 'code' in error)
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = (error && typeof error === 'object' && 'message' in error)
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  switch (code) {
    case '22023':
      return message.includes('24時間') ? '24時間以上の修正は無効です' : `不正なパラメータ: ${message}`;
    case '28000':
      return '未認証です。ログインし直してください';
    case 'P0002':
      return '申請が見つかりません (削除済みの可能性)';
    case '40001':
      return 'この申請は既に処理済みです。画面をリロードしてください';
    case '42501':
      return '権限がありません (manager / owner のみ)';
    default:
      return `承認処理に失敗しました: ${message || '不明なエラー'}`;
  }
}

export function useCorrection(tenantId: string) {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchRequests = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('correction_requests')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests((data as CorrectionRequest[]) || []);
    } catch (err: unknown) {
      logger.error('Fetch correction requests error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const submitRequest = async (data: {
    date: string;
    store_id?: string;
    attendance_record_id?: string;
    requested_clock_in?: string;
    requested_clock_out?: string;
    reason: string;
    request_type?: 'correction' | 'delete';
  }) => {
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const insertPayload: Record<string, any> = {
        tenant_id: tenantId,
        user_id: user.id,
        date: data.date,
        reason: data.reason,
        status: 'pending',
      };

      if (data.request_type) {
        insertPayload.request_type = data.request_type;
      }

      if (data.store_id) {
        insertPayload.store_id = data.store_id;
      }

      if (data.attendance_record_id) {
        insertPayload.attendance_record_id = data.attendance_record_id;
      }
      if (data.requested_clock_in) {
        insertPayload.requested_clock_in = data.requested_clock_in;
      }
      if (data.requested_clock_out) {
        insertPayload.requested_clock_out = data.requested_clock_out;
      }

      let { error } = await supabase
        .from('correction_requests')
        .insert(insertPayload);

      if (error && insertPayload.request_type) {
        const fallbackPayload = { ...insertPayload };
        fallbackPayload.reason = `[${data.request_type}] ${data.reason}`;
        delete fallbackPayload.request_type;
        const res = await supabase.from('correction_requests').insert(fallbackPayload);
        error = res.error;
      }

      if (error) {
        logger.error('Submit correction request error:', formatSupabaseError(error));
        setError(formatSupabaseError(error).message);
        throw error;
      }
      await fetchRequests();
    } catch (err: unknown) {
      logger.error('Submit correction request error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      throw err;
    }
  };

  const reviewRequest = async (
    requestId: string,
    reviewStatus: 'approved' | 'rejected',
  ) => {
    setError(null);
    try {
      const { data, error } = await supabase.rpc('review_correction_request', {
        p_request_id: requestId,
        p_review_status: reviewStatus,
      });
      if (error) {
        logger.error('Review correction request error:', formatSupabaseError(error));
        const friendly = mapReviewErrorCode(error);
        setError(friendly);
        throw new Error(friendly);
      }
      await fetchRequests();
      return data;
    } catch (err: unknown) {
      logger.error('Review correction request error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      throw err;
    }
  };

  const revertRequest = async (requestId: string) => {
    setError(null);
    try {
      const { error } = await supabase
        .from('correction_requests')
        .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
        .eq('id', requestId);
      if (error) {
        logger.error('Revert correction request error:', formatSupabaseError(error));
        setError(formatSupabaseError(error).message);
        throw error;
      }
      // 承認済の場合、すでに attendance_records へ反映済の修正は取り消さない（巻き戻しは別途手動で）
      await fetchRequests();
    } catch (err: unknown) {
      logger.error('Revert correction request error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      throw err;
    }
  };

  // Realtime 購読: tenant 内の correction_requests を監視し、変更があれば自動再取得
  useEffect(() => {
    if (!tenantId) return;

    // 冪等 cleanup
    if (channelRef.current) {
      try { supabase.removeChannel(channelRef.current); } catch (e) { console.warn('[useCorrection] removeChannel failed:', e); }
      channelRef.current = null;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`correction_requests:${tenantId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'correction_requests',
            filter: `tenant_id=eq.${tenantId}`,
          },
          () => { void fetchRequests(); }
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || err) {
            console.warn('[useCorrection] subscribe status:', status, err);
          }
        });
      channelRef.current = channel;
    } catch (e) {
      console.warn('[useCorrection] channel setup failed:', e);
      setError(e instanceof Error ? e.message : String(e));
      if (channel) {
        try { supabase.removeChannel(channel); } catch (re) { console.warn('[useCorrection] removeChannel after fail:', re); }
      }
      channelRef.current = null;
      return;
    }

    return () => {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch (e) { console.warn('[useCorrection] removeChannel failed:', e); }
        channelRef.current = null;
      }
    };
  }, [tenantId, fetchRequests]);

  return { requests, loading, error, fetchRequests, submitRequest, reviewRequest, revertRequest };
}
