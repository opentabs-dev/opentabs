import { ToolError, clearAuthCache, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { authError, getGraphToken } from '../microsoft-word-api.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export const copyItem = defineTool({
  name: 'copy_item',
  displayName: 'Copy Item',
  description:
    'Copy a file or folder. The copy operation is asynchronous — returns success immediately. The new copy appears in the destination folder shortly after.',
  summary: 'Copy a file or folder',
  icon: 'copy',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('ID of the file or folder to copy'),
    destination_id: z.string().describe('ID of the destination folder'),
    name: z.string().optional().describe('New name for the copy — defaults to original name'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the copy operation was accepted'),
  }),
  handle: async params => {
    const token = getGraphToken();
    const url = `${GRAPH_API_BASE}/me/drive/items/${params.item_id}/copy`;

    const body: Record<string, unknown> = {
      parentReference: { id: params.destination_id },
    };
    if (params.name !== undefined) body.name = params.name;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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

    if (response.status === 404) {
      throw ToolError.notFound('The requested item was not found.');
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

    return { success: true };
  },
});
