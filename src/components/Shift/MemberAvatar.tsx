import type { TenantMember } from '../../types';
import { getRoleColor } from './CalShiftBar';

export function MemberAvatar({ member, size = 18 }: { member?: TenantMember; size?: number }) {
  const rc = getRoleColor(member);
  const name = member?.display_name ?? '?';
  const initial = name.charAt(0).toUpperCase();

  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `${rc}1a`,
        color: rc,
        fontSize: Math.round(size * 0.55),
        lineHeight: 1,
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
