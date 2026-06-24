import { ToolError, clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { authError, getGraphToken } from '../microsoft-word-api.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export const getFileContent = defineTool({
  name: 'get_file_content',
  displayName: 'Get File Content',
  description:
    'Read text content of a file by its ID. Works with text-based files (.txt, .md, .csv, .html, .json, .xml, .yaml, .log, etc.). For Word documents (.docx), use get_document_text instead.',
  summary: 'Read text content of a file',
  icon: 'file-code',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('File ID'),
  }),
  output: z.object({
    content: z.string().describe('File text content'),
    size: z.number().describe('Content size in bytes'),
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
        throw ToolError.notFound('File not found.');
      }
      if (!metaResp.ok) {
        throw ToolError.internal(`Failed to get file metadata (${metaResp.status})`);
      }

      const meta = (await metaResp.json()) as {
        '@microsoft.graph.downloadUrl'?: string;
      };

      if (!meta['@microsoft.graph.downloadUrl']) {
        throw ToolError.internal('No download URL available for this file.');
      }

      downloadUrl = meta['@microsoft.graph.downloadUrl'];
    } catch (err) {
      if (err instanceof ToolError) throw err;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw ToolError.timeout('Request timed out.');
      }
      throw ToolError.internal(`Failed to get file: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    // Download and read as text
    try {
      const resp = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        throw ToolError.internal(`Failed to download file (${resp.status})`);
      }
      const content = await resp.text();
      return {
        content,
        size: content.length,
      };
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw ToolError.internal(`Failed to read file: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  },
});
