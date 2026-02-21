import MDX from '@/components/MDX';
import TableOfContents from '@/components/TableOfContents';
import { generateToc } from '@/lib/toc';
import { allDocs } from 'content-collections';
import { format } from 'date-fns';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface IProps {
  params: Promise<{ slug?: string[] }>;
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
      <div className="mx-auto w-full max-w-2xl min-w-0 flex-1 overflow-hidden px-4 py-12">
        <h1 className="mb-4 text-4xl font-bold tracking-tight">{doc.title}</h1>
        <div>
          <MDX code={doc.body} />
        </div>
        <p className="mt-12 text-right">Last Updated: {format(new Date(doc.lastUpdated), 'dd MMM, yyy')}</p>
      </div>

      {/* Table of Contents */}
      <div className="sticky top-36 hidden flex-shrink-0 space-y-6 self-start lg:block lg:w-60">
        <TableOfContents toc={toc} />
      </div>
    </>
  );
}
