import React from 'react';
import { cn } from '../../lib/cn';

const gapMap = {
  sm: 'space-y-4',
  md: 'space-y-6',
  lg: 'space-y-8',
} as const;

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div';
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
}

/**
 * セクションまたはコンテナのブロック要素を生成し、子要素間に垂直方向の均等な間隔を設けます。
 * @example
 * <Section gap="lg">
 *   <h2>見出し</h2>
 *   <p>コンテンツ</p>
 * </Section>
 */
export const Section: React.FC<SectionProps> = ({
  as: Component = 'section',
  gap = 'md',
  className,
  children,
  ...props
}) => {
  return (
    <Component className={cn(gapMap[gap], className)} {...props}>
      {children}
    </Component>
  );
};
