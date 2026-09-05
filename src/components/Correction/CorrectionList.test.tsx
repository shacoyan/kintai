// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CorrectionList } from './CorrectionList';
import type { CorrectionRequest } from '../../types';

afterEach(() => {
  cleanup();
});

function makeRequest(overrides: Partial<CorrectionRequest> = {}): CorrectionRequest {
  return {
    id: 'req-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    date: '2026-09-05',
    attendance_record_id: null,
    requested_clock_in: '2026-09-05T09:00:00.000Z',
    requested_clock_out: '2026-09-05T18:00:00.000Z',
    reason: '打刻漏れのため',
    request_type: 'correction',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    created_at: new Date(2026, 8, 5, 9, 30).toISOString(),
    store_id: null,
    ...overrides,
  };
}

describe('CorrectionList - 申請者名 / 申請日時', () => {
  it('memberNames が渡されると申請者名と申請日時が SP/PC 両方に表示される', () => {
    const requests = [makeRequest()];
    const memberNames = new Map([['user-1', '山田太郎']]);
    render(<CorrectionList requests={requests} memberNames={memberNames} />);

    expect(screen.getAllByText('山田太郎').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2026\/09\/05 09:30/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/申請 9\/5 09:30/)).toBeTruthy();
  });

  it('memberNames が無いと「不明」表示になる', () => {
    const requests = [makeRequest()];
    render(<CorrectionList requests={requests} />);

    expect(screen.getAllByText('不明').length).toBeGreaterThanOrEqual(1);
  });

  it('created_at が空文字でも例外を投げず「-」表示になる', () => {
    const requests = [makeRequest({ created_at: '' as unknown as string })];
    expect(() =>
      render(<CorrectionList requests={requests} memberNames={new Map([['user-1', '山田太郎']])} />)
    ).not.toThrow();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });
});
