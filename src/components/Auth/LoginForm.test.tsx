// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from './LoginForm';

const signInMock = vi.fn();
const signUpMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signIn: signInMock,
    signUp: signUpMock,
    signOut: vi.fn(),
  }),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

beforeEach(() => {
  signInMock.mockReset();
  signUpMock.mockReset();
  showToastMock.mockReset();
  signInMock.mockResolvedValue(undefined);
  signUpMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('LoginForm - 新規登録5項目化', () => {
  it('初期表示（ログインモード）では本名/フリガナ/勤務時名の入力欄が存在しない', () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText(/本名/)).toBeNull();
    expect(screen.queryByLabelText(/フリガナ/)).toBeNull();
    expect(screen.queryByLabelText(/勤務時名/)).toBeNull();
  });

  it('「新規登録」に切り替えると5つの入力欄が全て存在する', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

    expect(screen.getByLabelText(/メールアドレス/, { selector: 'input' })).toBeTruthy();
    expect(screen.getByLabelText(/^パスワード/, { selector: 'input' })).toBeTruthy();
    expect(screen.getByLabelText(/^本名/, { selector: 'input' })).toBeTruthy();
    expect(screen.getByLabelText(/^フリガナ/, { selector: 'input' })).toBeTruthy();
    expect(screen.getByLabelText(/^勤務時名/, { selector: 'input' })).toBeTruthy();
  });

  it('5項目を埋めてsubmitするとsignUpがtrimされた値で1回呼ばれる', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

    fireEvent.change(screen.getByLabelText(/メールアドレス/, { selector: 'input' }), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^パスワード/, { selector: 'input' }), {
      target: { value: 'pw' },
    });
    fireEvent.change(screen.getByLabelText(/^本名/, { selector: 'input' }), {
      target: { value: '  山田 太郎  ' },
    });
    fireEvent.change(screen.getByLabelText(/^フリガナ/, { selector: 'input' }), {
      target: { value: '  ヤマダ タロウ  ' },
    });
    fireEvent.change(screen.getByLabelText(/^勤務時名/, { selector: 'input' }), {
      target: { value: '  たろう  ' },
    });

    const form = screen.getByRole('button', { name: '新規登録' }).closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledTimes(1);
    });
    expect(signUpMock).toHaveBeenCalledWith('a@example.com', 'pw', {
      legalName: '山田 太郎',
      legalNameKana: 'ヤマダ タロウ',
      displayName: 'たろう',
    });
  });

  it('本名を空のままsubmitするとsignUpが呼ばれずエラー文言が表示される', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

    fireEvent.change(screen.getByLabelText(/メールアドレス/, { selector: 'input' }), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^パスワード/, { selector: 'input' }), {
      target: { value: 'pw' },
    });
    fireEvent.change(screen.getByLabelText(/^本名/, { selector: 'input' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText(/^フリガナ/, { selector: 'input' }), {
      target: { value: 'ヤマダ タロウ' },
    });
    fireEvent.change(screen.getByLabelText(/^勤務時名/, { selector: 'input' }), {
      target: { value: 'たろう' },
    });

    const form = screen.getByRole('button', { name: '新規登録' }).closest('form');
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(
        screen.getByText('本名 / フリガナ / 勤務時名 をすべて入力してください。'),
      ).toBeTruthy();
    });
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
