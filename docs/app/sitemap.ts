import { allDocs } from 'content-collections';
import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://opentabs.dev',
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 1,
    },
    ...allDocs.map(doc => ({
      url: `https://opentabs.dev${doc.url}`,
      lastModified: new Date(doc.lastUpdated),
    })),
  ];
}
