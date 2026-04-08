import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CorrectionRequest } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

export function useCorrection(tenantId: string) {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRequests = useCallback(async () => {
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
      console.error('Fetch correction requests error:', err.message);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const submitRequest = async (data: {
    date: string;
    attendance_record_id?: string;
    requested_clock_in?: string;
    requested_clock_out?: string;
    reason: string;
    request_type?: 'correction' | 'delete';
  }) => {
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

    // request_type カラムが存在しない場合にも対応
    if (data.request_type) {
      insertPayload.request_type = data.request_type;
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

    // request_type カラムが未追加の場合、フォールバック（reason に種別を含めて再送）
    if (error && insertPayload.request_type) {
      const fallbackPayload = { ...insertPayload };
      fallbackPayload.reason = `[${data.request_type}] ${data.reason}`;
      delete fallbackPayload.request_type;
      const res = await supabase.from('correction_requests').insert(fallbackPayload);
      error = res.error;
    }

    if (error) {
      console.error('Submit correction request error:', error.message);
      throw error;
    }
    await fetchRequests();
  };

  const reviewRequest = async (
    requestId: string,
    reviewStatus: 'approved' | 'rejected'
  ) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Update the request status
    const { error } = await supabase
      .from('correction_requests')
      .update({
        status: reviewStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId);
    if (error) {
      console.error('Review correction request error:', error.message);
      throw error;
    }

    // On approval, apply the change — fetch fresh from DB to avoid stale closure
    if (reviewStatus === 'approved') {
      const { data: targetData } = await supabase
        .from('correction_requests')
        .select('*')
        .eq('id', requestId)
        .single();
      const target = targetData as CorrectionRequest | null;

      if (target) {
        if (target.request_type === 'delete' && target.attendance_record_id) {
          // 削除
          const { error: delError } = await supabase
            .from('attendance_records')
            .delete()
            .eq('id', target.attendance_record_id);
          if (delError) {
            throw new Error(`勤怠レコードの削除に失敗: ${delError.message}`);
          }
        } else if (target.request_type !== 'delete') {
          const clockIn = target.requested_clock_in || null;
          const clockOut = target.requested_clock_out || null;

          // total_work_minutes を計算
          let totalWorkMinutes: number | null = null;
          if (clockIn && clockOut) {
            totalWorkMinutes = differenceInMinutes(parseISO(clockOut), parseISO(clockIn));
            // 既存レコードがあれば休憩分を差し引く
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
            // 既存レコードを更新
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
            // レコードなしの日 → 新規作成
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
      }
    }

    await fetchRequests();
  };

  return { requests, loading, fetchRequests, submitRequest, reviewRequest };
}
