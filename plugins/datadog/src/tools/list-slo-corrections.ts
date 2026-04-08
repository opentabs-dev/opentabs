import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listSloCorrections = defineTool({
  name: 'list_slo_corrections',
  displayName: 'List SLO Corrections',
  description: 'List all SLO status corrections in the Datadog organization.',
  summary: 'List SLO corrections',
  icon: 'target',
  group: 'SLOs',
  input: z.object({}),
  output: z.object({
    corrections: z.array(
      z.object({
        id: z.string().describe('Correction ID'),
        slo_id: z.string().describe('Associated SLO ID'),
        category: z.string().describe('Correction category'),
        start: z.number().describe('Correction start time (epoch seconds)'),
        end: z.number().describe('Correction end time (epoch seconds)'),
        description: z.string().describe('Correction description'),
      }),
    ),
  }),
  handle: async () => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v1/slo/correction');
    const corrections = (data.data ?? []).map(c => {
      const attrs = (c.attributes as Record<string, unknown>) ?? c;
      return {
        id: (c.id as string) ?? '',
        slo_id: (attrs.slo_id as string) ?? '',
        category: (attrs.category as string) ?? '',
        start: (attrs.start as number) ?? 0,
        end: (attrs.end as number) ?? 0,
        description: (attrs.description as string) ?? '',
      };
    });
    return { corrections };
  },
});
