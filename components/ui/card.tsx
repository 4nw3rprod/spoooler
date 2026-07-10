import * as React from 'react';
import {cn} from '../../lib/utils';

export const Card = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm',
      className,
    )}
    {...props}
  />
);
export const CardHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pb-3', className)} {...props} />
);
export const CardTitle = ({className, ...props}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('text-base font-semibold tracking-tight leading-none', className)} {...props} />
);
export const CardDescription = ({className, ...props}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
);
export const CardContent = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pt-3', className)} {...props} />
);
