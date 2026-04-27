import { useState, useCallback } from 'react';
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
    } catch (err: any) {
      console.error('Fetch correction requests error:', formatSupabaseError(err));
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
        console.error('Submit correction request error:', formatSupabaseError(error));
        setError(formatSupabaseError(error).message);
        throw error;
      }
      await fetchRequests();
    } catch (err: unknown) {
      console.error('Submit correction request error:', formatSupabaseError(err));
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

      const { error } = await supabase
        .from('correction_requests')
        .update({
          status: reviewStatus,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);
      if (error) {
        console.error('Review correction request error:', formatSupabaseError(error));
        setError(formatSupabaseError(error).message);
        throw error;
      }

      if (reviewStatus === 'approved') {
        const { data: targetData } = await supabase
          .from('correction_requests')
          .select('*')
          .eq('id', requestId)
          .single();
        const target = targetData as CorrectionRequest | null;

        if (target) {
          if (target.request_type === 'delete' && target.attendance_record_id) {
            const { error: delError } = await supabase
              .from('attendance_records')
              .delete()
              .eq('id', target.attendance_record_id);
            if (delError) {
              throw new Error(`勤怠レコードの削除に失敗: ${delError.message}`);
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
                const { error: updError } = await supabase
                  .from('attendance_records')
                  .update(updateData)
                  .eq('id', target.attendance_record_id);
                if (updError) {
                  throw new Error(`勤怠レコードの更新に失敗: ${updError.message}`);
                }
              }
            } else if (clockIn) {
              const { error: insError } = await supabase
                .from('attendance_records')
                .insert({
                  tenant_id: target.tenant_id,
                  user_id: target.user_id,
                  date: target.date,
                  clock_in: clockIn,
                  clock_out: clockOut,
                  total_work_minutes: totalWorkMinutes,
                });
              if (insError) {
                throw new Error(`勤怠レコードの作成に失敗: ${insError.message}`);
              }
            }
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
        const { data: targetData } = await supabase
          .from('correction_requests')
          .select('*')
          .eq('id', requestId)
          .single();
        const target = targetData as CorrectionRequest | null;

        if (target) {
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
      console.error('Review correction request error:', formatSupabaseError(err));
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
        console.error('Revert correction request error:', formatSupabaseError(error));
        setError(formatSupabaseError(error).message);
        throw error;
      }
      // 承認済の場合、すでに attendance_records へ反映済の修正は取り消さない（巻き戻しは別途手動で）
      await fetchRequests();
    } catch (err: unknown) {
      console.error('Revert correction request error:', formatSupabaseError(err));
      setError(formatSupabaseError(err).message);
      throw err;
    }
  };

  return { requests, loading, error, fetchRequests, submitRequest, reviewRequest, revertRequest };
}
