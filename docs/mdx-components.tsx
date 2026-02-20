import { RetroAccordions, RetroAccordion } from '@/components/retro-accordion';
import { RetroFiles, RetroFile, RetroFolder } from '@/components/retro-files';
import { RetroSteps, RetroStep } from '@/components/retro-steps';
import { RetroTabs, RetroTab } from '@/components/retro-tabs';
import { RetroCodeBlock, Pre } from '@/components/retroui-codeblock';
import { cn } from '@/lib/utils';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { CodeBlockProps } from 'fumadocs-ui/components/codeblock';
import type { MDXComponents } from 'mdx/types';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// Mapping from Fumadocs callout type to RetroUI Alert status color classes (theme-aware)
const calloutStatusClasses: Record<string, string> = {
  info: 'bg-info text-info-foreground border-info-border',
  warn: 'bg-warning text-warning-foreground border-warning-border',
  warning: 'bg-warning text-warning-foreground border-warning-border',
  error: 'bg-destructive text-destructive-foreground border-destructive',
  success: 'bg-success text-success-foreground border-success-border',
  idea: 'bg-info text-info-foreground border-info-border',
};

interface CalloutProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  type?: string;
  title?: ReactNode;
  icon?: ReactNode;
}

const RetroCallout = ({ className, type = 'info', title, icon: _icon, children, ...props }: CalloutProps) => {
  const statusClasses = calloutStatusClasses[type] ?? calloutStatusClasses.info;
  return (
    <div role="alert" className={cn('relative my-6 w-full border-2 p-4 md:p-5', statusClasses, className)} {...props}>
      {title && <p className="font-head mb-2 text-lg font-semibold">{title}</p>}
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
      <h3 className="font-head mb-2 text-xl font-medium">{title}</h3>
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
          'bg-card block border-2 p-4 shadow-md transition-all hover:translate-y-0.5 hover:shadow-none',
          className,
        )}>
        {content}
      </a>
    );
  }

  return (
    <div className={cn('bg-card border-2 p-4 shadow-md transition-all hover:shadow-none', className)} {...props}>
      {content}
    </div>
  );
};

const RetroCards = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('my-8 grid grid-cols-1 gap-5 sm:grid-cols-2', className)} {...props} />
);

export const getMDXComponents = (components?: MDXComponents): MDXComponents => ({
  ...defaultMdxComponents,
  h1: ({ className, children, ...props }: ComponentPropsWithoutRef<'h1'>) => (
    <h1 className={cn('font-head mt-12 mb-5 text-2xl font-bold md:text-4xl lg:text-5xl', className)} {...props}>
      {children}
    </h1>
  ),
  h2: ({ className, children, ...props }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className={cn('font-head mt-10 mb-4 text-xl font-semibold md:text-3xl lg:text-4xl', className)} {...props}>
      {children}
    </h2>
  ),
  h3: ({ className, children, ...props }: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className={cn('font-head mt-8 mb-3 text-lg font-medium md:text-2xl', className)} {...props}>
      {children}
    </h3>
  ),
  h4: ({ className, children, ...props }: ComponentPropsWithoutRef<'h4'>) => (
    <h4 className={cn('font-head mt-6 mb-2 text-xl font-normal', className)} {...props}>
      {children}
    </h4>
  ),
  h5: ({ className, children, ...props }: ComponentPropsWithoutRef<'h5'>) => (
    <h5 className={cn('font-head mt-6 mb-2 text-lg font-normal', className)} {...props}>
      {children}
    </h5>
  ),
  h6: ({ className, children, ...props }: ComponentPropsWithoutRef<'h6'>) => (
    <h6 className={cn('font-head mt-4 mb-2 text-base font-normal', className)} {...props}>
      {children}
    </h6>
  ),
  p: ({ className, ...props }: ComponentPropsWithoutRef<'p'>) => (
    <p className={cn('mb-4 font-sans text-base leading-relaxed', className)} {...props} />
  ),
  ul: ({ className, ...props }: ComponentPropsWithoutRef<'ul'>) => (
    <ul className={cn('mb-5 list-outside list-disc space-y-2 pl-6 font-sans', className)} {...props} />
  ),
  ol: ({ className, ...props }: ComponentPropsWithoutRef<'ol'>) => (
    <ol className={cn('mb-5 list-outside list-decimal space-y-2 pl-6 font-sans', className)} {...props} />
  ),
  li: ({ className, ...props }: ComponentPropsWithoutRef<'li'>) => (
    <li className={cn('font-sans text-base leading-relaxed', className)} {...props} />
  ),
  blockquote: ({ className, ...props }: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className={cn(
        'border-primary bg-accent/20 my-6 border-l-4 px-4 py-3 font-sans leading-relaxed italic',
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }: ComponentPropsWithoutRef<'hr'>) => (
    <hr className={cn('border-border my-8 border-x-0 border-t-2 border-b-0', className)} {...props} />
  ),
  // Fenced code blocks — RetroUI styling: border-2 shadow-md, primary title bar, outline copy button
  pre: (props: CodeBlockProps) => (
    <RetroCodeBlock {...props}>
      <Pre>{props.children}</Pre>
    </RetroCodeBlock>
  ),
  // Inline code — skips fenced code blocks (those have shiki style props from the rehype transform).
  // The style prop presence distinguishes fenced blocks (shiki adds --shiki-* CSS variables) from inline `code`.
  code: ({ className, style, ...props }: ComponentPropsWithoutRef<'code'>) =>
    style ? (
      <code className={className} style={style} {...props} />
    ) : (
      <code
        className={cn(
          'bg-muted border-border border px-1.5 py-0.5 font-mono text-sm font-semibold break-words sm:border-2',
          className,
        )}
        {...props}
      />
    ),
  table: ({ className, ...props }: ComponentPropsWithoutRef<'table'>) => (
    <div className="relative my-6 w-full overflow-auto">
      <table className={cn('w-full caption-bottom border-2 text-sm shadow-lg', className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }: ComponentPropsWithoutRef<'thead'>) => (
    <thead className={cn('bg-primary text-primary-foreground font-head [&_tr]:border-b-2', className)} {...props} />
  ),
  tbody: ({ className, ...props }: ComponentPropsWithoutRef<'tbody'>) => (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
  tr: ({ className, ...props }: ComponentPropsWithoutRef<'tr'>) => (
    <tr className={cn('hover:bg-primary/15 border-b-2 transition-colors', className)} {...props} />
  ),
  th: ({ className, ...props }: ComponentPropsWithoutRef<'th'>) => (
    <th
      className={cn('text-primary-foreground h-12 px-2 text-left align-middle font-medium md:px-4', className)}
      {...props}
    />
  ),
  td: ({ className, ...props }: ComponentPropsWithoutRef<'td'>) => (
    <td className={cn('px-2 py-2 align-middle md:px-4 md:py-3', className)} {...props} />
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
  // Steps — CSS counter-based numbered steps with RetroUI primary color indicators
  Steps: RetroSteps,
  Step: RetroStep,
  // File tree — Card-like container (border-2, shadow-md) with primary color folder icons
  Files: RetroFiles,
  File: RetroFile,
  Folder: RetroFolder,
  ...components,
});
