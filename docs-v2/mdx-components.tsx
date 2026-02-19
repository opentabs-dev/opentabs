import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    h1: ({ className, ...props }: ComponentPropsWithoutRef<'h1'>) => (
      <h1 className={cn('font-head mt-8 mb-4 text-4xl font-bold lg:text-5xl', className)} {...props} />
    ),
    h2: ({ className, ...props }: ComponentPropsWithoutRef<'h2'>) => (
      <h2 className={cn('font-head mt-8 mb-3 text-3xl font-semibold lg:text-4xl', className)} {...props} />
    ),
    h3: ({ className, ...props }: ComponentPropsWithoutRef<'h3'>) => (
      <h3 className={cn('font-head mt-6 mb-2 text-2xl font-medium', className)} {...props} />
    ),
    h4: ({ className, ...props }: ComponentPropsWithoutRef<'h4'>) => (
      <h4 className={cn('font-head mt-4 mb-2 text-xl font-normal', className)} {...props} />
    ),
    h5: ({ className, ...props }: ComponentPropsWithoutRef<'h5'>) => (
      <h5 className={cn('font-head mt-4 mb-2 text-lg font-normal', className)} {...props} />
    ),
    h6: ({ className, ...props }: ComponentPropsWithoutRef<'h6'>) => (
      <h6 className={cn('font-head mt-4 mb-2 text-base font-normal', className)} {...props} />
    ),
    p: ({ className, ...props }: ComponentPropsWithoutRef<'p'>) => (
      <p className={cn('mb-4 font-sans text-base', className)} {...props} />
    ),
    ul: ({ className, ...props }: ComponentPropsWithoutRef<'ul'>) => (
      <ul className={cn('mb-4 list-outside list-disc space-y-1 pl-6 font-sans', className)} {...props} />
    ),
    ol: ({ className, ...props }: ComponentPropsWithoutRef<'ol'>) => (
      <ol className={cn('mb-4 list-outside list-decimal space-y-1 pl-6 font-sans', className)} {...props} />
    ),
    li: ({ className, ...props }: ComponentPropsWithoutRef<'li'>) => (
      <li className={cn('font-sans text-base', className)} {...props} />
    ),
    blockquote: ({ className, ...props }: ComponentPropsWithoutRef<'blockquote'>) => (
      <blockquote
        className={cn('border-primary bg-accent/20 my-4 border-l-4 px-4 py-3 font-sans', className)}
        {...props}
      />
    ),
    // Inline code — does not affect fenced code blocks (those are handled by the pre override)
    code: ({ className, ...props }: ComponentPropsWithoutRef<'code'>) => (
      <code className={cn('bg-muted border-border border px-1.5 py-0.5 font-mono text-sm', className)} {...props} />
    ),
    table: ({ className, ...props }: ComponentPropsWithoutRef<'table'>) => (
      <div className="relative my-6 w-full overflow-auto">
        <table className={cn('w-full caption-bottom border-2 text-sm shadow-lg', className)} {...props} />
      </div>
    ),
    thead: ({ className, ...props }: ComponentPropsWithoutRef<'thead'>) => (
      <thead className={cn('bg-primary text-primary-foreground font-head [&_tr]:border-b', className)} {...props} />
    ),
    tbody: ({ className, ...props }: ComponentPropsWithoutRef<'tbody'>) => (
      <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
    ),
    tr: ({ className, ...props }: ComponentPropsWithoutRef<'tr'>) => (
      <tr
        className={cn('hover:bg-primary/50 hover:text-primary-foreground border-b transition-colors', className)}
        {...props}
      />
    ),
    th: ({ className, ...props }: ComponentPropsWithoutRef<'th'>) => (
      <th
        className={cn('text-primary-foreground h-10 px-4 text-left align-middle font-medium md:h-12', className)}
        {...props}
      />
    ),
    td: ({ className, ...props }: ComponentPropsWithoutRef<'td'>) => (
      <td className={cn('p-2 align-middle md:p-3', className)} {...props} />
    ),
    ...components,
  };
}
