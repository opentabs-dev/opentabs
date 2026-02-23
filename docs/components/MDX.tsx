'use client';

import { CodeBlock } from './CodeBlock';
import { CliCommand } from './ComponentInstall';
import {
  ArchitectureIllustration,
  ConfigDirectory,
  DispatchFlow,
  LifecycleSequence,
  MonorepoStructure,
  PluginStructure,
  ProgressFlow,
  QuickStartFlow,
} from './illustrations';
import { Table } from './retroui/Table';
import { Alert, Badge, Card, Text } from '@/components/retroui';
import { cn } from '@/lib/utils';
import { MDXContent } from '@content-collections/mdx/react';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import Image from 'next/image';
import Link from 'next/link';
import type { AnchorHTMLAttributes, HTMLAttributes } from 'react';
import type React from 'react';

const docComponents = {
  h1: (props: HTMLAttributes<HTMLHeadingElement>) => (
    <Text as="h1" className="mt-10 mb-4 [&:first-child]:mt-0" {...props} />
  ),
  h2: (props: HTMLAttributes<HTMLHeadingElement>) => (
    <Text as="h2" className="mt-10 mb-6 border-b pb-1 [&:first-child]:mt-0" {...props} />
  ),
  h3: (props: HTMLAttributes<HTMLHeadingElement>) => (
    <Text as="h3" className="mt-8 mb-3 [&:first-child]:mt-0" {...props} />
  ),
  h4: (props: HTMLAttributes<HTMLHeadingElement>) => (
    <Text as="h4" className="mt-6 mb-2 [&:first-child]:mt-0" {...props} />
  ),
  h5: (props: HTMLAttributes<HTMLHeadElement>) => (
    <Text as="h5" className="mt-4 mb-1 [&:first-child]:mt-0" {...props} />
  ),
  h6: (props: HTMLAttributes<HTMLHeadElement>) => (
    <Text as="h6" className="mt-4 mb-1 [&:first-child]:mt-0" {...props} />
  ),
  p: (props: HTMLAttributes<HTMLParagraphElement>) => <Text className="mb-4 leading-relaxed" {...props} />,
  ul: (props: HTMLAttributes<HTMLUListElement>) => <ul className="mb-4 ml-6 list-disc space-y-1.5" {...props} />,
  ol: (props: HTMLAttributes<HTMLOListElement>) => <ol className="mb-4 ml-6 list-decimal space-y-1.5" {...props} />,
  li: ({ className, ...props }: HTMLAttributes<HTMLLIElement>) => (
    <li className={cn('leading-relaxed [&>p]:mb-2 [&>p:last-child]:mb-0', className)} {...props} />
  ),
  blockquote: (props: HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-primary text-muted-foreground my-6 border-l-4 pl-4 italic" {...props} />
  ),
  hr: (props: HTMLAttributes<HTMLHRElement>) => <hr className="border-border my-8 border-t-2" {...props} />,
  // alt is passed through from MDX image syntax and spread via ...props
  img: ({ alt = '', ...props }: HTMLAttributes<HTMLImageElement> & { alt?: string }) => (
    <img alt={alt} className="mx-auto my-8 w-full max-w-[600px]" {...props} />
  ),
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const { href, target, rel, children, ...rest } = props;
    if (!href) return <span {...rest}>{children}</span>;
    const isExternal = href.startsWith('http');
    return isExternal ? (
      <a
        href={href}
        target={target ?? '_blank'}
        rel={rel ?? 'noopener noreferrer'}
        className="hover:decoration-primary underline underline-offset-4"
        {...rest}>
        {children}
      </a>
    ) : (
      <Link href={href} className="hover:decoration-primary underline underline-offset-4" {...rest}>
        {children}
      </Link>
    );
  },
  pre: CodeBlock,
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code className={cn('bg-code-bg text-primary relative rounded-(--radius) p-1 text-sm', className)} {...props}>
      {children}
    </code>
  ),
  TabGroup,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Table,
  Link,
  Badge,
  Image,
  Card,
  Alert,
  CliCommand,
  ArchitectureIllustration,
  ConfigDirectory,
  DispatchFlow,
  LifecycleSequence,
  MonorepoStructure,
  QuickStartFlow,
  PluginStructure,
  ProgressFlow,
};

const blogComponents = {
  ...docComponents,
  h2: (props: HTMLAttributes<HTMLHeadingElement>) => (
    <Text as="h2" className="mt-10 mb-4 [&:first-child]:mt-0" {...props} />
  ),
  p: (props: HTMLAttributes<HTMLParagraphElement>) => (
    <Text className="text-foreground mb-4 text-lg leading-relaxed" {...props} />
  ),
};

export default function MDX({ code, type = 'doc' }: { code: string; type?: 'doc' | 'blog' }) {
  const components = type === 'blog' ? blogComponents : docComponents;

  return <MDXContent code={code} components={components} />;
}
