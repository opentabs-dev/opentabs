import { defineTool, fetchFromPage, getCookie, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const getAppDocs = defineTool({
  name: 'get_app_docs',
  displayName: 'Get App Docs',
  description:
    'Get the documentation and usage notes for a Retool application. Returns the editor-written description that explains the app purpose and usage.',
  summary: 'Get app documentation by UUID',
  icon: 'file-text',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
  }),
  output: z.object({
    documentation: z.string().describe('App documentation content'),
  }),
  handle: async params => {
    const xsrf = getCookie('xsrfToken');
    if (!xsrf) throw ToolError.auth('Not authenticated — please log in to Retool.');

    const response = await fetchFromPage(`/api/pages/uuids/${params.page_uuid}/documentation`, {
      headers: { 'X-Xsrf-Token': xsrf, 'Content-Type': 'application/json' },
    });
    const text = await response.text();

    // Endpoint may return plain text, JSON with a documentation field, or empty
    if (!text) return { documentation: '' };
    try {
      const json = JSON.parse(text) as { documentation?: string };
      return { documentation: json.documentation ?? text };
    } catch {
      return { documentation: text };
    }
  },
});
