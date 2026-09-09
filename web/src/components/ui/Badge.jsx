import React from 'react';
import { cn } from '../../lib/utils.js';

const variants = {
  default:     'bg-primary/10 text-primary',
  destructive: 'bg-destructive/10 text-destructive',
  secondary:   'bg-secondary text-secondary-foreground',
  success:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  outline:     'border border-border text-foreground',
};

export default function Badge({ className, variant = 'default', children }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  );
}
