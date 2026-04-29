import React from 'react';
import { cn } from '../../lib/cn';

const gapMap = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
} as const;

const alignMap = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const;

const justifyMap = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
} as const;

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'row' | 'col';
  gap?: 'xs' | 'sm' | 'md' | 'lg';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  className?: string;
  children: React.ReactNode;
}

/**
 * Flexboxを用いて子要素を縦または横に並べるレイアウトプリミティブです。
 * @example
 * <Stack direction="row" gap="md" align="center" justify="between">
 *   <div>Left</div>
 *   <div>Right</div>
 * </Stack>
 */
export const Stack: React.FC<StackProps> = ({
  direction = 'col',
  gap = 'sm',
  align,
  justify,
  className,
  children,
  ...props
}) => {
  const dirClass = direction === 'row' ? 'flex-row' : 'flex-col';
  const alignClass = align ? alignMap[align] : undefined;
  const justifyClass = justify ? justifyMap[justify] : undefined;

  return (
    <div
      className={cn('flex', dirClass, gapMap[gap], alignClass, justifyClass, className)}
      {...props}
    >
      {children}
    </div>
  );
};
