import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'text',
  width,
  height,
  count = 1,
}) => {
  const baseClass = 'motion-safe:animate-pulse bg-stone-200 dark:bg-stone-800';
  const variantClass = {
    text: 'rounded-md h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  }[variant];

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  if (count === 1) {
    return <div className={`${baseClass} ${variantClass} ${className}`} style={style} />;
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${baseClass} ${variantClass} ${className}`} style={style} />
      ))}
    </div>
  );
};

// Pre-built skeleton patterns
export const CardSkeleton: React.FC = () => (
  <div className="rounded-[10px] border border-stone-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-stone-700 dark:bg-stone-900 space-y-3">
    <Skeleton variant="text" width="60%" height={20} />
    <Skeleton variant="text" count={3} />
    <Skeleton variant="rectangular" height={40} />
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-2">
    <Skeleton variant="rectangular" height={40} className="w-full" />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} variant="rectangular" height={32} className="w-full" />
    ))}
  </div>
);

export const PageSkeleton: React.FC = () => (
  <div className="w-full space-y-6">
    <Skeleton variant="text" width="40%" height={28} />
    <div className="space-y-4">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  </div>
);

export const ListRowSkeleton: React.FC = () => (
  <div className="py-3 px-4 border-b border-stone-200 dark:border-stone-700 space-y-2">
    <Skeleton variant="text" width="70%" height={16} />
    <Skeleton variant="text" width="40%" height={12} />
  </div>
);

// Page-specific skeleton variants (Loop 12 L12-13)
export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6 p-4">
    <Skeleton variant="text" width="40%" height={28} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
    <Skeleton variant="rectangular" height={120} />
  </div>
);

export const HistorySkeleton: React.FC = () => (
  <div className="space-y-4 p-4">
    <Skeleton variant="text" width="30%" height={28} />
    <Skeleton variant="rectangular" height={280} />
    <TableSkeleton rows={6} />
  </div>
);

export const ShiftSkeleton: React.FC = () => (
  <div className="space-y-4 p-4">
    <Skeleton variant="text" width="35%" height={28} />
    <div className="grid grid-cols-7 gap-2">
      {Array.from({ length: 35 }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={80} />
      ))}
    </div>
  </div>
);

export const AdminSkeleton: React.FC = () => (
  <div className="space-y-4 p-4">
    <Skeleton variant="text" width="30%" height={28} />
    <div className="flex gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" width={80} height={32} />
      ))}
    </div>
    <TableSkeleton rows={8} />
  </div>
);
