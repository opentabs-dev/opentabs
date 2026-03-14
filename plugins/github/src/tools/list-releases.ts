import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';
import { releaseSchema } from './schemas.js';

export const listReleases = defineTool({
  name: 'list_releases',
  displayName: 'List Releases',
  description: 'List releases for a repository. Returns published and draft releases sorted by creation date.',
  summary: 'List releases for a repository',
  icon: 'package',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
  }),
  output: z.object({
    releases: z.array(releaseSchema).describe('List of releases'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    const html = await fetchText(`/${params.owner}/${params.repo}/releases`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Parse releases from the HTML page
    const releaseCards = doc.querySelectorAll('[data-testid="release-card"], .release, section');
    const releases = [];

    for (const card of releaseCards) {
      const tagEl = card.querySelector('[data-testid="release-card-tag"], .release-tag, a[href*="tag"]');
      const titleEl = card.querySelector('[data-testid="release-card-title"], .release-title, h2 a');
      const bodyEl = card.querySelector('.markdown-body');
      const timeEl = card.querySelector('relative-time, time');
      const authorEl = card.querySelector('a[data-hovercard-type="user"]');
      const isDraft = card.textContent?.includes('Draft') ?? false;
      const isPrerelease = card.textContent?.includes('Pre-release') ?? false;

      const tagName = tagEl?.textContent?.trim() ?? '';
      if (!tagName) continue;

      releases.push({
        id: 0,
        tag_name: tagName,
        name: titleEl?.textContent?.trim() ?? tagName,
        body: bodyEl?.textContent?.trim() ?? '',
        draft: isDraft,
        prerelease: isPrerelease,
        created_at: timeEl?.getAttribute('datetime') ?? '',
        published_at: timeEl?.getAttribute('datetime') ?? '',
        html_url: `https://github.com/${params.owner}/${params.repo}/releases/tag/${tagName}`,
        author_login: authorEl?.textContent?.trim() ?? '',
      });
    }

    return { releases };
  },
});
