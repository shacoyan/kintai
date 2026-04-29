import React from 'react'
import { cn } from '../../lib/cn'

/**
 * Design System heading primitive.
 *
 * Renders a semantic `<h1>`–`<h6>` element with consistent typographic tokens
 * determined by the required `level` prop.  Use the optional `as` prop when
 * visual level and semantic level must differ (e.g. an `<h2>` that visually
 * matches level 3 sizing).
 *
 * @example
 * <Heading level={1}>Main title</Heading>
 *
 * @example
 * <Heading level={3} as="h2">Section title</Heading>
 */
export type HeadingLevel = 1 | 2 | 3 | 4

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level: HeadingLevel
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  className?: string
  children?: React.ReactNode
}

const levelClassMap: Record<HeadingLevel, string> = {
  1: 'text-heading-1 text-neutral-900 dark:text-neutral-50',
  2: 'text-heading-2 text-neutral-900 dark:text-neutral-50',
  3: 'text-heading-3 text-neutral-800 dark:text-neutral-100',
  4: 'text-body font-semibold text-neutral-800 dark:text-neutral-100',
}

export const Heading: React.FC<HeadingProps> = ({
  level,
  as,
  className,
  children,
  ...rest
}) => {
  const Tag = as ?? (`h${level}` as const)

  return (
    <Tag className={cn(levelClassMap[level], className)} {...rest}>
      {children}
    </Tag>
  )
}

