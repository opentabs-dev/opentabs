import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildPlaceUrl } from '../maps-api.js';

export const getPlaceUrl = defineTool({
  name: 'get_place_url',
  displayName: 'Get Place URL',
  description:
    'Generate a Google Maps URL for a specific place that can be shared. Does not navigate — just returns the URL. Useful for embedding in messages, documents, or other contexts.',
  summary: 'Generate a shareable place link',
  icon: 'external-link',
  group: 'Sharing',
  input: z.object({
    query: z.string().describe('Place name or address (e.g., "Eiffel Tower", "123 Main St, Springfield, IL")'),
  }),
  output: z.object({
    url: z.string().describe('Shareable Google Maps place URL'),
  }),
  handle: async params => {
    const path = buildPlaceUrl(params.query);
    return { url: `https://www.google.com${path}` };
  },
});
