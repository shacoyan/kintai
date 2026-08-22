import { describe, it, expect } from 'vitest';
import { readSignupProfile } from './userProfile';
import type { User } from '@supabase/supabase-js';

function makeUser(metadata: Record<string, unknown>): User {
  return {
    id: 'u1',
    app_metadata: {},
    user_metadata: metadata,
    aud: 'authenticated',
    created_at: '',
  } as unknown as User;
}

describe('readSignupProfile', () => {
  it('returns null when user is null', () => {
    expect(readSignupProfile(null)).toBeNull();
  });

  it('returns null when user is undefined', () => {
    expect(readSignupProfile(undefined)).toBeNull();
  });

  it('returns the trimmed profile when all fields present', () => {
    const user = makeUser({
      legal_name: '  山田太郎  ',
      legal_name_kana: '  ヤマダタロウ  ',
      display_name: '  たろう  ',
    });
    expect(readSignupProfile(user)).toEqual({
      legalName: '山田太郎',
      legalNameKana: 'ヤマダタロウ',
      displayName: 'たろう',
    });
  });

  it('allows legal_name_kana to be missing and defaults to empty string', () => {
    const user = makeUser({
      legal_name: '山田太郎',
      display_name: 'たろう',
    });
    expect(readSignupProfile(user)).toEqual({
      legalName: '山田太郎',
      legalNameKana: '',
      displayName: 'たろう',
    });
  });

  it('returns null when legal_name is missing', () => {
    const user = makeUser({
      display_name: 'たろう',
    });
    expect(readSignupProfile(user)).toBeNull();
  });

  it('returns null when display_name is missing', () => {
    const user = makeUser({
      legal_name: '山田太郎',
    });
    expect(readSignupProfile(user)).toBeNull();
  });

  it('returns null when legal_name exceeds 50 characters', () => {
    const user = makeUser({
      legal_name: 'a'.repeat(51),
      display_name: 'たろう',
    });
    expect(readSignupProfile(user)).toBeNull();
  });

  it('returns null when legal_name_kana exceeds 50 characters', () => {
    const user = makeUser({
      legal_name: '山田太郎',
      legal_name_kana: 'a'.repeat(51),
      display_name: 'たろう',
    });
    expect(readSignupProfile(user)).toBeNull();
  });

  it('returns null when display_name exceeds 30 characters', () => {
    const user = makeUser({
      legal_name: '山田太郎',
      display_name: 'a'.repeat(31),
    });
    expect(readSignupProfile(user)).toBeNull();
  });
});
