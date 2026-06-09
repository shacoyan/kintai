'use client';

import React from 'react';
import { MOTION } from '../../../lib/sales/motion';

export interface ChartLegendItem {
  id: string;
  label: string;
  color: string;
  disabled?: boolean;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md';
  hiddenIds?: string[];
  onToggle?: (id: string) => void;
  highlightOnHover?: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export const ChartLegend: React.FC<ChartLegendProps> = ({
  items,
  orientation = 'horizontal',
  size = 'sm',
  hiddenIds,
  onToggle,
  highlightOnHover = true,
  align = 'center',
  className,
}) => {
  const isInteractive = !!onToggle;

  const alignClasses =
    orientation === 'horizontal'
      ? {
          start: 'justify-start',
          center: 'justify-center',
          end: 'justify-end',
        }
      : {
          start: 'items-start',
          center: 'items-center',
          end: 'items-end',
        };

  const ulClasses = [
    'flex',
    orientation === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
    'gap-x-3',
    'gap-y-1.5',
    alignClasses[align],
    highlightOnHover ? '[&:hover>li:not(:hover)]:opacity-30 transition-opacity' : '',
    highlightOnHover && isInteractive
      ? '[&:hover>button:not(:hover)]:opacity-30 transition-opacity'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const dotSizeClass = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm';

  const renderItemContent = (item: ChartLegendItem, isHidden: boolean) => {
    const dotStyle = isHidden
      ? { borderColor: item.color, backgroundColor: 'transparent' }
      : { backgroundColor: item.color };

    return (
      <span
        className={`inline-flex items-center gap-2 ${isHidden ? 'line-through opacity-60' : ''}`}
      >
        <span
          className={`${dotSizeClass} rounded-sm ${isHidden ? 'border-2 bg-transparent' : ''}`}
          style={dotStyle}
        />
        <span className={`text-text-muted ${textSizeClass}`}>{item.label}</span>
      </span>
    );
  };

  return (
    <ul className={ulClasses}>
      {items.map((item) => {
        const isHidden = hiddenIds?.includes(item.id) || !!item.disabled;

        if (isInteractive) {
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={!isHidden}
                onClick={() => onToggle?.(item.id)}
                className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary rounded-sm ${MOTION.fast}`}
              >
                {renderItemContent(item, isHidden)}
              </button>
            </li>
          );
        }

        return <li key={item.id}>{renderItemContent(item, isHidden)}</li>;
      })}
    </ul>
  );
};
