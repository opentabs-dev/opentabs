import { ToolError, clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildDocx } from '../docx-utils.js';
import { authError, getGraphToken } from '../microsoft-word-api.js';
import { type RawDriveItem, driveItemSchema, mapDriveItem } from './schemas.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export const createDocument = defineTool({
  name: 'create_document',
  displayName: 'Create Document',
  description:
    'Create a new Word document (.docx) with the given text content. Each string in the paragraphs array becomes a separate paragraph in the document. The file is created at the specified path in OneDrive.',
  summary: 'Create a new Word document with text',
  icon: 'file-plus',
  group: 'Documents',
  input: z.object({
    path: z
      .string()
      .min(1)
      .describe('File path relative to drive root, must end with .docx (e.g., "Documents/report.docx")'),
    paragraphs: z.array(z.string()).min(1).describe('Array of text paragraphs for the document content'),
  }),
  output: z.object({
    item: driveItemSchema.describe('The created document'),
  }),
  handle: async params => {
    const token = getGraphToken();
    const docxBytes = buildDocx(params.paragraphs);

    // Create a clean ArrayBuffer copy for the fetch body.
    // buildDocx returns Uint8Array whose .buffer is ArrayBufferLike — TS doesn't
    // accept that as BodyInit. Constructing a new ArrayBuffer via slice fixes it.
    const body = new ArrayBuffer(docxBytes.byteLength);
    new Uint8Array(body).set(docxBytes);

    const encodedPath = encodeURIComponent(params.path).replace(/%2F/g, '/');
    const url = `${GRAPH_API_BASE}/me/drive/root:/${encodedPath}:/content`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw ToolError.timeout('Microsoft Graph API request timed out.');
      }
      throw ToolError.internal(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    if (response.status === 401 || response.status === 403) {
      clearAuthCache('microsoft-word');
      authError('Authentication expired — please refresh the page.');
    }

    if (!response.ok) {
      let errorMsg = `Microsoft Graph API error (${response.status})`;
      try {
        const errBody = (await response.json()) as {
          error?: { message?: string };
        };
        if (errBody.error?.message) errorMsg = errBody.error.message;
      } catch {
        // ignore parse errors
      }
      throw ToolError.internal(errorMsg);
    }

    const data = (await response.json()) as RawDriveItem;
    return { item: mapDriveItem(data) };
  },
});
