import { ToolError, clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { extractTextFromDocumentXml, extractZipEntry } from '../docx-utils.js';
import { authError, getGraphToken } from '../microsoft-word-api.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export const getDocumentText = defineTool({
  name: 'get_document_text',
  displayName: 'Get Document Text',
  description:
    'Extract plain text content from a Word document (.docx). Downloads the binary file, decompresses the OOXML archive, and extracts text from all paragraphs. Returns paragraphs as an array of strings.',
  summary: 'Extract text from a Word document',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    item_id: z.string().describe('File ID of the .docx document (from list_children or search_files)'),
  }),
  output: z.object({
    paragraphs: z.array(z.string()).describe('Text paragraphs extracted from the document'),
    text: z.string().describe('Full document text with paragraphs joined by newlines'),
  }),
  handle: async params => {
    const token = getGraphToken();

    // Get the pre-authenticated download URL from item metadata
    let downloadUrl: string;
    try {
      const metaResp = await fetch(`${GRAPH_API_BASE}/me/drive/items/${params.item_id}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      });

      if (metaResp.status === 401 || metaResp.status === 403) {
        clearAuthCache('microsoft-word');
        authError('Authentication expired — please refresh the page.');
      }
      if (metaResp.status === 404) {
        throw ToolError.notFound('Document not found.');
      }
      if (!metaResp.ok) {
        throw ToolError.internal(`Failed to get document metadata (${metaResp.status})`);
      }

      const meta = (await metaResp.json()) as {
        '@microsoft.graph.downloadUrl'?: string;
        file?: { mimeType?: string };
      };

      if (!meta['@microsoft.graph.downloadUrl']) {
        throw ToolError.internal('No download URL available for this item.');
      }

      // Verify it's a .docx file
      const mimeType = meta.file?.mimeType ?? '';
      if (mimeType && !mimeType.includes('wordprocessingml') && !mimeType.includes('msword')) {
        throw ToolError.validation(
          `This file is not a Word document (${mimeType}). Use get_file_content for text-based files.`,
        );
      }

      downloadUrl = meta['@microsoft.graph.downloadUrl'];
    } catch (err) {
      if (err instanceof ToolError) throw err;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw ToolError.timeout('Request timed out.');
      }
      throw ToolError.internal(`Failed to get document: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    // Download the .docx binary
    let docBytes: Uint8Array;
    try {
      const docResp = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!docResp.ok) {
        throw ToolError.internal(`Failed to download document (${docResp.status})`);
      }
      docBytes = new Uint8Array(await docResp.arrayBuffer());
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw ToolError.internal(`Failed to download: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    // Extract word/document.xml from the ZIP archive
    const xml = await extractZipEntry(docBytes, 'word/document.xml');
    if (!xml) {
      throw ToolError.internal('Could not find word/document.xml in the .docx archive.');
    }

    const paragraphs = extractTextFromDocumentXml(xml);
    return {
      paragraphs,
      text: paragraphs.join('\n'),
    };
  },
});
