import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { vercelApi } from '../vercel-api.js';
import { domainSchema, mapDomain } from './schemas.js';

export const listDomains = defineTool({
  name: 'list_domains',
  displayName: 'List Domains',
  description: 'List all domains configured for a Vercel project. Shows DNS configuration status and redirects.',
  summary: 'List project domains',
  icon: 'globe',
  group: 'Domains',
  input: z.object({
    project: z.string().describe('Project name or ID'),
  }),
  output: z.object({
    domains: z.array(domainSchema).describe('List of domains'),
  }),
  handle: async params => {
    const data = await vercelApi<Record<string, unknown>>(`/v9/projects/${encodeURIComponent(params.project)}/domains`);
    const domains = Array.isArray(data.domains) ? (data.domains as Record<string, unknown>[]) : [];
    return { domains: domains.map(d => mapDomain(d)) };
  },
});
