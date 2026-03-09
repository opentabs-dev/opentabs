import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getWorkspaceId } from '../clickup-api.js';
import { customFieldSchema, mapCustomField } from './schemas.js';

export const getCustomFields = defineTool({
  name: 'get_custom_fields',
  displayName: 'Get Custom Fields',
  description:
    'List all custom fields defined in a ClickUp workspace. Custom fields add structured data to tasks (text, number, dropdown, checkbox, date, email, URL, etc.).',
  summary: 'List workspace custom fields',
  icon: 'sliders-horizontal',
  group: 'Custom Fields',
  input: z.object({
    workspace_id: z.string().optional().describe('Workspace ID. Defaults to the current workspace.'),
  }),
  output: z.object({
    fields: z.array(customFieldSchema).describe('List of custom fields'),
  }),
  handle: async params => {
    const wsId = params.workspace_id ?? getWorkspaceId();
    const data = await api<{ fields: Record<string, unknown>[] }>(`/customFields/v1/team/${wsId}/fields`);
    return { fields: (data.fields ?? []).map(mapCustomField) };
  },
});
