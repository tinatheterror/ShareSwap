import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveGridProps {
  children: ReactNode;
  className?: string;
  columns?: '1' | '2' | '3' | '4' | 'auto';
}

export function ResponsiveGrid({ children, className, columns = 'auto' }: ResponsiveGridProps) {
  const columnClasses = {
    '1': 'grid-cols-1',
    '2': 'grid-cols-1 sm:grid-cols-2',
    '3': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    '4': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    'auto': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  };

  return (
    <div className={cn(
      'grid gap-4 md:gap-6 lg:gap-8',
      columnClasses[columns],
      className
    )}>
      {children}
    </div>
  );
}

interface ResponsiveStackProps {
  children: ReactNode;
  className?: string;
  gap?: 'sm' | 'md' | 'lg';
}

export function ResponsiveStack({ children, className, gap = 'md' }: ResponsiveStackProps) {
  const gapClasses = {
    'sm': 'gap-2 md:gap-3 lg:gap-4',
    'md': 'gap-4 md:gap-6 lg:gap-8',
    'lg': 'gap-6 md:gap-8 lg:gap-10',
  };

  return (
    <div className={cn('flex flex-col', gapClasses[gap], className)}>
      {children}
    </div>
  );
}
