import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { driveApi, resolveDocumentId } from '../google-docs-api.js';
import { COMMENT_LIST_FIELDS, commentSchema, mapComment, type RawComment } from './schemas.js';

const KIX_PATTERN = /kix\.[a-z0-9]{12,}/g;

/**
 * Fetch the set of `kix.*` named-range IDs that exist in the current document.
 *
 * Google Docs assigns a `kix.<id>` named range to every comment anchor position.
 * When the anchored text is deleted, the named range is removed from the document.
 * The server-rendered page HTML embeds these IDs, so a same-origin fetch + regex
 * extraction gives us the complete set of live anchor positions — no text matching,
 * no fuzzy logic, just a structural ID lookup.
 *
 * Returns null on failure so the caller can skip orphan filtering gracefully.
 */
const fetchLiveAnchorIds = async (documentId: string): Promise<Set<string> | null> => {
  try {
    const resp = await fetch(
      `${window.location.origin}/document/d/${encodeURIComponent(documentId)}/edit`,
      { credentials: 'include' },
    );
    if (!resp.ok) return null;
    const html = await resp.text();
    return new Set(html.match(KIX_PATTERN) ?? []);
  } catch {
    return null;
  }
};

/**
 * Fetch ALL comments from the Drive API, paginating through all pages internally.
 * Client-side filtering (status, orphan detection) requires the full comment set
 * to produce correct results — otherwise comments near the end of the list get
 * missed when earlier pages are dominated by filtered-out comments.
 */
const fetchAllComments = async (documentId: string, includeDeleted: boolean): Promise<RawComment[]> => {
  const allComments: RawComment[] = [];
  let pageToken: string | undefined;

  do {
    const data = await driveApi<{ nextPageToken?: string; comments?: RawComment[] }>(
      `/files/${encodeURIComponent(documentId)}/comments`,
      {
        params: {
          fields: COMMENT_LIST_FIELDS,
          pageSize: 100,
          pageToken,
          includeDeleted,
        },
      },
    );
    allComments.push(...(data.comments ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allComments;
};

export const listComments = defineTool({
  name: 'list_comments',
  displayName: 'List Comments',
  description:
    'List comment threads on a Google Doc, including replies, resolution status, and the quoted document text each comment is anchored to. Returns comments ordered by creation time. By default, only open (unresolved) comments are returned — use the status parameter to include resolved or all comments. Orphaned comments (anchored to text that was deleted from the document) are excluded by default.',
  summary: 'List comments on a document',
  icon: 'message-square',
  group: 'Comments',
  input: z.object({
    document_id: z
      .string()
      .optional()
      .describe('Google Docs document ID. Defaults to the document open in the current editor tab.'),
    status: z
      .enum(['open', 'resolved', 'all'])
      .optional()
      .describe(
        'Filter by comment status: "open" (default) returns only unresolved comments that need attention, "resolved" returns only resolved/closed comments, "all" returns both',
      ),
    include_orphaned: z
      .boolean()
      .optional()
      .describe(
        'Include orphaned comments whose anchored text no longer exists in the document (default false). Orphaned comments are typically left over from previous revisions of the document and are hidden by the Google Docs UI.',
      ),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of comments to return (default 50, max 100)'),
    page_token: z.string().optional().describe('Page token from a previous list_comments call'),
    include_deleted: z.boolean().optional().describe('Include deleted comments (default false)'),
  }),
  output: z.object({
    comments: z.array(commentSchema).describe('Comment threads on the document'),
    next_page_token: z.string().describe('Token for the next page, empty if there are no more results'),
  }),
  handle: async params => {
    const documentId = resolveDocumentId(params.document_id);
    const status = params.status ?? 'open';
    const includeOrphaned = params.include_orphaned ?? false;
    const pageSize = params.page_size ?? 50;

    // Fetch all comments internally so client-side filtering produces correct results.
    // Without this, pagination boundaries cause filtered results to be incomplete —
    // e.g., page 1 returns 50 raw comments but only 17 survive filtering, while the
    // remaining matching comments sit on page 2 and the consumer never sees them.
    const rawComments = await fetchAllComments(documentId, params.include_deleted ?? false);
    let comments = rawComments.map(mapComment);

    if (status === 'open') {
      comments = comments.filter(c => !c.resolved);
    } else if (status === 'resolved') {
      comments = comments.filter(c => c.resolved);
    }

    if (!includeOrphaned) {
      const liveAnchors = await fetchLiveAnchorIds(documentId);
      if (liveAnchors) {
        comments = comments.filter(c => c.anchor !== '' && liveAnchors.has(c.anchor));
      }
      // If the page fetch fails, skip orphan filtering rather than
      // dropping all comments — graceful degradation.
    }

    // Apply pagination on the filtered results.
    const startIndex = params.page_token ? Number.parseInt(params.page_token, 10) : 0;
    const page = comments.slice(startIndex, startIndex + pageSize);
    const nextStart = startIndex + pageSize;
    const hasMore = nextStart < comments.length;

    return {
      comments: page,
      next_page_token: hasMore ? String(nextStart) : '',
    };
  },
});
