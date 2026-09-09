import React from 'react';
import { cn } from '../../lib/utils.js';
import Spinner from './Spinner.jsx';

const variants = {
  default:     'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline:     'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost:       'hover:bg-accent hover:text-accent-foreground',
  secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  link:        'text-primary underline-offset-4 hover:underline',
};
const sizes = {
  default: 'h-9 px-4 py-2 text-sm',
  sm:      'h-7 px-3 text-xs',
  lg:      'h-11 px-8 text-base',
  icon:    'h-9 w-9',
};

export function buttonClassName({ variant = 'default', size = 'default', className } = {}) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium ring-offset-background transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    variants[variant], sizes[size], className,
  );
}

export default function Button({ className, variant = 'default', size = 'default', loading, asChild = false, children, ...props }) {
  const classes = buttonClassName({ variant, size, className });

  if (asChild) {
    const child = React.Children.only(children);
    const disabled = loading || props.disabled;
    return React.cloneElement(child, {
      ...props,
      className: cn(classes, disabled && 'pointer-events-none opacity-50', child.props.className),
      'aria-disabled': disabled || undefined,
      onClick: (e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        child.props.onClick?.(e);
        props.onClick?.(e);
      },
    });
  }

  return (
    <button
      className={classes}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
