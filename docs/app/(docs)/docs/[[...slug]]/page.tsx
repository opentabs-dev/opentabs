import { allDocs } from 'content-collections';
import { format } from 'date-fns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MDX from '@/components/MDX';
import TableOfContents from '@/components/TableOfContents';
import { generateToc } from '@/lib/toc';

interface IProps {
  params: Promise<{ slug?: string[] }>;
}

export function generateStaticParams() {
  return [
    // The index page: /docs (no slug segments)
    { slug: [] },
    // All other doc pages: /docs/foo, /docs/foo/bar, etc.
    ...allDocs
      .filter(doc => doc.url !== '/docs')
      .map(doc => ({ slug: doc.url.replace(/^\/docs\//, '').split('/') })),
  ];
}

const getDoc = (slug: string[] | undefined) => {
  const path = `/docs${slug ? `/${slug.join('/')}` : ''}`;
  return allDocs.find(doc => doc.url === path) ?? null;
};

export const generateMetadata = async ({ params }: IProps): Promise<Metadata> => {
  const { slug } = await params;
  const doc = getDoc(slug);

  if (!doc) {
    return { title: 'Not Found | OpenTabs' };
  }

  return {
    title: `${doc.title} | OpenTabs`,
    description: doc.description,
  };
};

export default async function DocPage({ params }: IProps) {
  const { slug } = await params;
  const doc = getDoc(slug);

  if (!doc) {
    return notFound();
  }

  const toc = await generateToc(doc.content);
  return (
    <>
      {/* Main Content */}
      <div className="w-full min-w-0 max-w-2xl flex-1 overflow-hidden px-4 py-12">
        <h1 className="mb-4 font-bold text-4xl tracking-tight">{doc.title}</h1>
        <MDX code={doc.body} />
        <p className="mt-12 text-right">Last Updated: {format(new Date(doc.lastUpdated), 'dd MMM, yyyy')}</p>
      </div>

      {/* Table of Contents */}
      <div className="sticky top-20 hidden flex-shrink-0 self-start lg:block lg:w-60">
        <TableOfContents toc={toc} />
      </div>
    </>
  );
}
