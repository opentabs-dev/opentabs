import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { driveApi, driveApiRaw, resolveDocumentId } from '../google-docs-api.js';
import { COMMENT_LIST_FIELDS, commentSchema, mapComment, type RawComment } from './schemas.js';

/**
 * Decode HTML entities that appear in quoted_text anchors from the Drive API.
 * For example, `&quot;` → `"`, `&amp;` → `&`, `&#39;` → `'`.
 */
const unescapeHtmlEntities = (text: string): string =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

/** Collapse runs of whitespace into a single space for anchor matching. */
const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Check whether a comment's anchor text still exists in the current document body.
 * Comments anchored to text that has been deleted or rewritten are considered orphaned
 * and are hidden by the Google Docs UI.
 */
const isAnchoredInDocument = (quotedText: string, normalizedDocText: string): boolean => {
  if (!quotedText) return true;
  const anchor = normalizeWhitespace(unescapeHtmlEntities(quotedText));
  if (!anchor) return true;
  return normalizedDocText.includes(anchor);
};

/**
 * Fetch the current document body as plain text via the Drive export API.
 * This endpoint returns the complete document content including tables, headers,
 * and footers — unlike DOCS_modelChunk parsing which misses structured content.
 * Returns null if the export fails, signaling the caller to skip orphan filtering.
 */
const fetchDocumentPlainText = async (documentId: string): Promise<string | null> => {
  try {
    return await driveApiRaw(`/files/${encodeURIComponent(documentId)}/export`, {
      params: { mimeType: 'text/plain' },
    });
  } catch {
    return null;
  }
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

    const data = await driveApi<{ nextPageToken?: string; comments?: RawComment[] }>(
      `/files/${encodeURIComponent(documentId)}/comments`,
      {
        params: {
          fields: COMMENT_LIST_FIELDS,
          pageSize: params.page_size ?? 50,
          pageToken: params.page_token,
          includeDeleted: params.include_deleted ?? false,
        },
      },
    );

    let comments = (data.comments ?? []).map(mapComment);

    if (status === 'open') {
      comments = comments.filter(c => !c.resolved);
    } else if (status === 'resolved') {
      comments = comments.filter(c => c.resolved);
    }

    if (!includeOrphaned) {
      const docText = await fetchDocumentPlainText(documentId);
      if (docText) {
        const normalizedDocText = normalizeWhitespace(docText);
        comments = comments.filter(c => isAnchoredInDocument(c.quoted_text, normalizedDocText));
      }
      // If text export fails (null), skip orphan filtering rather than
      // dropping all comments — graceful degradation.
    }

    return {
      comments,
      next_page_token: data.nextPageToken ?? '',
    };
  },
});
