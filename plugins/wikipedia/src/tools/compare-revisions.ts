import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../wikipedia-api.js';

interface CompareResponse {
  compare?: {
    fromid?: number;
    fromrevid?: number;
    fromtitle?: string;
    toid?: number;
    torevid?: number;
    totitle?: string;
    body?: string;
  };
  error?: { code?: string; info?: string };
}

const stripDiffHtml = (html: string): string => {
  let result = html
    .replace(/<td class="diff-deletedline"[^>]*>(.*?)<\/td>/gs, '- $1\n')
    .replace(/<td class="diff-addedline"[^>]*>(.*?)<\/td>/gs, '+ $1\n')
    .replace(/<td class="diff-context"[^>]*>(.*?)<\/td>/gs, '  $1\n');
  // Decode HTML entities before stripping remaining tags so that encoded
  // angle brackets inside text content are decoded first, then the tag
  // stripping pass removes only actual markup — not decoded content.
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  // Strip remaining HTML tags — loop until stable for nested/malformed markup
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result.trim();
};

export const compareRevisions = defineTool({
  name: 'compare_revisions',
  displayName: 'Compare Revisions',
  description:
    'Compare two revisions of a Wikipedia article to see what changed. Returns a text diff showing additions and deletions. Provide two revision IDs from get_revisions.',
  summary: 'Compare two article revisions',
  icon: 'git-compare',
  group: 'Revisions',
  input: z.object({
    from_rev: z.number().int().describe('Source revision ID (older)'),
    to_rev: z.number().int().describe('Target revision ID (newer)'),
  }),
  output: z.object({
    from_title: z.string().describe('Article title of the source revision'),
    to_title: z.string().describe('Article title of the target revision'),
    diff: z.string().describe('Text diff showing changes (- for deletions, + for additions)'),
  }),
  handle: async params => {
    const data = await api<CompareResponse>({
      action: 'compare',
      fromrev: params.from_rev,
      torev: params.to_rev,
      prop: 'diff|title|ids',
    });

    if (data.error) {
      if (data.error.code === 'nosuchrevid') {
        throw ToolError.notFound(`Revision not found: ${data.error.info}`);
      }
      throw ToolError.internal(data.error.info ?? 'Compare failed');
    }

    return {
      from_title: data.compare?.fromtitle ?? '',
      to_title: data.compare?.totitle ?? '',
      diff: stripDiffHtml(data.compare?.body ?? ''),
    };
  },
});
