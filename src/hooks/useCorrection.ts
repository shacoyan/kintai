import { useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { CorrectionRequest } from '../types';
import type { NotificationType } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';
import { formatSupabaseError } from '../lib/errors';

async function notify(args: { tenantId: string; userId: string; type: NotificationType; title: string; body?: string | null; link?: string | null; }) {
  try {
    const { error: nerr } = await supabase.from('notifications').insert({
      tenant_id: args.tenantId, user_id: args.userId, type: args.type,
      title: args.title, body: args.body ?? null, link: args.link ?? null,
    });
    if (nerr) console.warn('[notify] insert failed:', nerr.message);
  } catch (e) { console.warn('[notify] threw:', e); }
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
    options?: { onApproved?: (target: CorrectionRequest) => void | Promise<void> }
  ) => {
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (reviewStatus === 'approved') {
        const { data: targetData, error: targetError } = await supabase
          .from('correction_requests')
          .select('*')
          .eq('id', requestId)
          .single();
        if (targetError) {
          throw new Error(`申請の取得に失敗: ${targetError.message}`);
        }
        if (!targetData) {
          throw new Error('申請が見つかりません (削除済み or 権限不足の可能性)。');
        }
        const target = targetData as CorrectionRequest;

        {
          if (target.request_type === 'delete' && target.attendance_record_id) {
            const { data: delData, error: delError } = await supabase
              .from('attendance_records')
              .delete()
              .eq('id', target.attendance_record_id)
              .select('id');
            if (delError) {
              throw new Error(`勤怠レコードの削除に失敗: ${delError.message}`);
            }
            if (!delData || delData.length === 0) {
              throw new Error('勤怠レコードの削除が拒否されました (権限不足の可能性)。RLS / レコード存在を確認してください。');
            }
          } else if (target.request_type !== 'delete') {
            let clockIn = target.requested_clock_in || null;
            let clockOut = target.requested_clock_out || null;

            if (target.attendance_record_id && (!clockIn || !clockOut)) {
              const { data: existingRecord } = await supabase
                .from('attendance_records')
                .select('clock_in, clock_out')
                .eq('id', target.attendance_record_id)
                .single();
              if (existingRecord) {
                if (!clockIn) clockIn = existingRecord.clock_in;
                if (!clockOut) clockOut = existingRecord.clock_out;
              }
            }

            let totalWorkMinutes: number | null = null;
            if (clockIn && clockOut) {
              let outDate = parseISO(clockOut);
              const inDate = parseISO(clockIn);

              // 夜勤跨ぎ補正: clockOut が clockIn より前 → 翌日扱い
              if (outDate < inDate) {
                outDate = new Date(outDate.getTime() + 24 * 60 * 60 * 1000);
                clockOut = outDate.toISOString();
              }

              // 24時間超過バリデーション
              if (Math.abs(differenceInMinutes(outDate, inDate)) > 24 * 60) {
                throw new Error('24時間以上の修正は無効です');
              }

              totalWorkMinutes = differenceInMinutes(outDate, inDate);

              if (target.attendance_record_id) {
                const { data: breaks } = await supabase
                  .from('breaks')
                  .select('start_time, end_time')
                  .eq('attendance_record_id', target.attendance_record_id);
                if (breaks) {
                  const breakMins = breaks.reduce((sum, b) => {
                    if (b.start_time && b.end_time) {
                      return sum + differenceInMinutes(parseISO(b.end_time), parseISO(b.start_time));
                    }
                    return sum;
                  }, 0);
                  totalWorkMinutes -= breakMins;
                }
              }
              totalWorkMinutes = Math.max(0, totalWorkMinutes);
            }

            if (target.attendance_record_id) {
              const updateData: Record<string, any> = {};
              if (clockIn) updateData.clock_in = clockIn;
              if (clockOut) updateData.clock_out = clockOut;
              if (totalWorkMinutes !== null) updateData.total_work_minutes = totalWorkMinutes;
              if (Object.keys(updateData).length > 0) {
                const { data: updData, error: updError } = await supabase
                  .from('attendance_records')
                  .update(updateData)
                  .eq('id', target.attendance_record_id)
                  .select('id');
                if (updError) {
                  throw new Error(`勤怠レコードの更新に失敗: ${updError.message}`);
                }
                if (!updData || updData.length === 0) {
                  throw new Error('勤怠レコードの更新が拒否されました (権限不足の可能性)。');
                }
              }
            } else if (clockIn) {
              const { data: insData, error: insError } = await supabase
                .from('attendance_records')
                .insert({
                  tenant_id: target.tenant_id,
                  user_id: target.user_id,
                  date: target.date,
                  clock_in: clockIn,
                  clock_out: clockOut,
                  total_work_minutes: totalWorkMinutes,
                })
                .select('id');
              if (insError) {
                throw new Error(`勤怠レコードの作成に失敗: ${insError.message}`);
              }
              if (!insData || insData.length === 0) {
                throw new Error('勤怠レコードの作成が拒否されました (権限不足の可能性)。');
              }
            }
          }

          // 勤怠レコードの操作が成功した後にのみ、correction_requestsのステータスを更新
          const { data: statusUpdData, error: updError } = await supabase
            .from('correction_requests')
            .update({
              status: reviewStatus,
              reviewed_by: user.id,
              reviewed_at: new Date().toISOString(),
            })
            .eq('id', requestId)
            .select('id');
          if (updError) {
            logger.error('Review correction request error:', formatSupabaseError(updError));
            setError(formatSupabaseError(updError).message);
            throw new Error(`申請ステータスの更新に失敗: ${updError.message}`);
          }
          if (!statusUpdData || statusUpdData.length === 0) {
            throw new Error('申請ステータスの更新が拒否されました (権限不足 / レコード消失の可能性)。');
          }

          await options?.onApproved?.(target);
          await notify({
            tenantId: target.tenant_id,
            userId: target.user_id,
            type: 'correction_approved',
            title: '修正申請が承認されました',
            body: target.date,
            link: `/history?date=${target.date}`,
          });
        }
      } else if (reviewStatus === 'rejected') {
        const { data: rejectUpdData, error: updError } = await supabase
          .from('correction_requests')
          .update({
            status: reviewStatus,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', requestId)
          .select('id');
        if (updError) {
          logger.error('Review correction request error:', formatSupabaseError(updError));
          setError(formatSupabaseError(updError).message);
          throw new Error(`申請の却下処理に失敗: ${updError.message}`);
        }
        if (!rejectUpdData || rejectUpdData.length === 0) {
          throw new Error('申請の却下処理が拒否されました (権限不足 / レコード消失の可能性)。');
        }

        const { data: targetData, error: targetError } = await supabase
          .from('correction_requests')
          .select('*')
          .eq('id', requestId)
          .single();
        if (targetError) {
          throw new Error(`申請の取得に失敗: ${targetError.message}`);
        }
        if (!targetData) {
          throw new Error('申請が見つかりません (削除済み or 権限不足の可能性)。');
        }
        const target = targetData as CorrectionRequest;

        {
          await notify({
            tenantId: target.tenant_id,
            userId: target.user_id,
            type: 'correction_rejected',
            title: '修正申請が却下されました',
            body: target.date,
            link: `/history?date=${target.date}`,
          });
        }
      }

      await fetchRequests();
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
