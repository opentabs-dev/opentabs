import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RetroCodeBlock, Pre } from '@/components/retroui-codeblock';
import type { CodeBlockProps } from 'fumadocs-ui/components/codeblock';
import { RetroTabs, RetroTab } from '@/components/retro-tabs';
import { RetroAccordions, RetroAccordion } from '@/components/retro-accordion';

// Mapping from Fumadocs callout type to RetroUI Alert status color classes
const calloutStatusClasses: Record<string, string> = {
  info: 'bg-blue-300 text-blue-800 border-blue-800',
  warn: 'bg-yellow-300 text-yellow-800 border-yellow-800',
  warning: 'bg-yellow-300 text-yellow-800 border-yellow-800',
  error: 'bg-red-300 text-red-800 border-red-800',
  success: 'bg-green-300 text-green-800 border-green-800',
  idea: 'bg-blue-300 text-blue-800 border-blue-800',
};

interface CalloutProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  type?: string;
  title?: ReactNode;
  icon?: ReactNode;
}

const RetroCallout = ({ className, type = 'info', title, icon: _icon, children, ...props }: CalloutProps) => {
  const statusClasses = calloutStatusClasses[type] ?? calloutStatusClasses.info;
  return (
    <div role="alert" className={cn('relative w-full rounded border-2 p-4', statusClasses, className)} {...props}>
      {title && <p className="font-head mb-1 text-lg font-semibold">{title}</p>}
      <div className="font-sans text-sm">{children}</div>
    </div>
  );
};

interface FumadocsCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  href?: string;
  external?: boolean;
}

const RetroCard = ({ className, title, description, icon, href, external, children, ...props }: FumadocsCardProps) => {
  const content = (
    <>
      {icon && <div className="mb-2 text-2xl">{icon}</div>}
      <h3 className="font-head mb-1 text-xl font-medium">{title}</h3>
      {description && <p className="text-muted-foreground font-sans text-sm">{description}</p>}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={cn(
          'bg-card block rounded border-2 p-4 shadow-md transition-all hover:translate-y-0.5 hover:shadow-none',
          className,
        )}>
        {content}
      </a>
    );
  }

  return (
    <div
      className={cn('bg-card rounded border-2 p-4 shadow-md transition-all hover:shadow-none', className)}
      {...props}>
      {content}
    </div>
  );
};

const RetroCards = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('my-6 grid grid-cols-1 gap-4 sm:grid-cols-2', className)} {...props} />
);

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
    // Fenced code blocks — RetroUI styling: border-2 shadow-md, primary title bar, outline copy button
    pre: (props: CodeBlockProps) => (
      <RetroCodeBlock {...props}>
        <Pre>{props.children}</Pre>
      </RetroCodeBlock>
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
    // Fumadocs MDX special components — overridden with RetroUI styling
    Callout: RetroCallout,
    Card: RetroCard,
    Cards: RetroCards,
    // Tabs — Radix UI root + RetroUI visual classes matching RetroUI Tab.tsx
    Tabs: RetroTabs,
    Tab: RetroTab,
    // Accordion — Radix UI primitives + RetroUI visual classes matching RetroUI Accordion.tsx
    Accordions: RetroAccordions,
    Accordion: RetroAccordion,
    ...components,
  };
}
