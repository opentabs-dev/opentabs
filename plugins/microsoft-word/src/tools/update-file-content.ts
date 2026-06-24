import { ToolError, clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { FILE_LOCKED_MESSAGE, authError, getGraphToken } from '../microsoft-word-api.js';
import { type RawDriveItem, driveItemSchema, mapDriveItem } from './schemas.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export const updateFileContent = defineTool({
  name: 'update_file_content',
  displayName: 'Update File Content',
  description: 'Update the content of an existing file by its ID.',
  summary: "Update a file's content",
  icon: 'file-pen',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('File ID'),
    content: z.string().describe('New file content'),
    content_type: z.string().optional().describe('MIME type (default "text/plain")'),
  }),
  output: z.object({
    item: driveItemSchema.describe('The updated file'),
  }),
  handle: async params => {
    const token = getGraphToken();
    const url = `${GRAPH_API_BASE}/me/drive/items/${params.item_id}/content`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': params.content_type ?? 'text/plain',
        },
        body: params.content,
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

    if (response.status === 423) {
      throw ToolError.validation(FILE_LOCKED_MESSAGE);
    }

    if (response.status === 404) {
      throw ToolError.notFound('The requested file was not found.');
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
