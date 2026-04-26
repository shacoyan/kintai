import type { ReactElement } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

export type IconElement = ReactElement<LucideProps>;
export type IconComponent = LucideIcon;
export type IconLike = IconComponent | IconElement;
