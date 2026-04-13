import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';

interface RawCountResponse {
  count?: number;
}

export const getDocumentCount = defineTool({
  name: 'get_document_count',
  displayName: 'Get Document Count',
  description: 'Get the total number of documents the current user has for a given product type.',
  summary: 'Count your documents',
  icon: 'hash',
  group: 'Documents',
  input: z.object({
    product: z.enum(['chart', 'press', 'spark']).optional().describe('Product type to count (default: chart)'),
  }),
  output: z.object({
    count: z.number().int().describe('Total number of documents'),
  }),
  handle: async params => {
    const userId = getUserId();
    const product = params.product ?? 'chart';
    const data = await docsApi<RawCountResponse>(`/users/${userId}/documents/${product}/count`);
    return { count: data.count ?? 0 };
  },
});
