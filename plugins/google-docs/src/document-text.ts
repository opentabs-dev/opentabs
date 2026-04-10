import { fetchText } from '@opentabs-dev/plugin-sdk';
import { resolveDocumentId } from './google-docs-api.js';

/**
 * Parse document text from the embedded DOCS_modelChunk JSON blobs in a Google Docs
 * HTML page. These chunks contain the document body content (paragraphs, tables, headings)
 * but NOT comment or discussion content.
 */
export const parseModelChunksFromHtml = (html: string): string | null => {
  const textChunks: Array<{ ibi: number; text: string }> = [];
  const marker = 'DOCS_modelChunk =';
  let searchFrom = 0;

  while (true) {
    const markerIdx = html.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;

    const jsonStart = html.indexOf('{', markerIdx + marker.length);
    if (jsonStart === -1) break;
    const semiIdx = html.indexOf(';', jsonStart);
    if (semiIdx === -1) break;
    searchFrom = semiIdx + 1;

    try {
      const chunkJson = JSON.parse(html.slice(jsonStart, semiIdx)) as Record<string, unknown>;
      const chunkOps = chunkJson.chunk as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(chunkOps)) continue;

      for (const op of chunkOps) {
        if (op.ty === 'is' && typeof op.s === 'string') {
          textChunks.push({ ibi: (op.ibi as number) || 1, text: op.s as string });
        }
      }
    } catch {
      // Malformed chunk — skip and try the next one.
    }
  }

  if (textChunks.length === 0) return null;
  textChunks.sort((a, b) => a.ibi - b.ibi);

  const rawText = textChunks.map(c => c.text).join('');
  const lines = rawText.split('\n').filter(line => line.length > 0);
  return lines.join('\n');
};

export const extractTitleFromHtml = (html: string): string => {
  const match = html.match(/<title>([^<]*)<\/title>/);
  if (!match?.[1]) return '';
  return match[1].replace(/ - Google Docs$/, '');
};

interface DocumentTextResult {
  text: string | null;
  title: string;
}

/**
 * Fetch the plain-text content and title of a Google Doc by document ID.
 * Returns the document body text (null if extraction fails) and the title.
 */
export const fetchDocumentText = async (documentId?: string): Promise<DocumentTextResult> => {
  const resolvedId = resolveDocumentId(documentId);
  const url = `${window.location.origin}/document/d/${resolvedId}/edit?tab=t.0&_cb=${Date.now()}`;
  const html = await fetchText(url, { cache: 'no-store' });
  return {
    text: parseModelChunksFromHtml(html),
    title: extractTitleFromHtml(html),
  };
};
