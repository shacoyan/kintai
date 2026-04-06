import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CorrectionRequest } from '../types';

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
      request_type: data.request_type || 'correction',
    };

    if (data.attendance_record_id) {
      insertPayload.attendance_record_id = data.attendance_record_id;
    }
    if (data.requested_clock_in) {
      insertPayload.requested_clock_in = data.requested_clock_in;
    }
    if (data.requested_clock_out) {
      insertPayload.requested_clock_out = data.requested_clock_out;
    }

    const { error } = await supabase
      .from('correction_requests')
      .insert(insertPayload);
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

    // If approving a delete request, delete the attendance record
    if (reviewStatus === 'approved') {
      const target = requests.find((r) => r.id === requestId);
      if (target && target.request_type === 'delete' && target.attendance_record_id) {
        const { error: delError } = await supabase
          .from('attendance_records')
          .delete()
          .eq('id', target.attendance_record_id);
        if (delError) {
          console.error('Delete attendance record error:', delError.message);
        }
      }
    }

    await fetchRequests();
  };

  return { requests, loading, fetchRequests, submitRequest, reviewRequest };
}
