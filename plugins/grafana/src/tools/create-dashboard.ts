import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../grafana-api.js';

interface SaveDashboardResponse {
  uid: string;
  url: string;
  version: number;
  status: string;
}

export const createDashboard = defineTool({
  name: 'create_dashboard',
  displayName: 'Create Dashboard',
  description:
    'Create a new dashboard. Provide a title and optionally tags, folder UID, and panel definitions as JSON.',
  summary: 'Create a new dashboard',
  icon: 'plus',
  group: 'Dashboards',
  input: z.object({
    title: z.string().describe('Dashboard title'),
    tags: z.array(z.string()).optional().describe('Dashboard tags'),
    folder_uid: z.string().optional().describe('Folder UID to create the dashboard in'),
    panels: z.string().optional().describe('JSON array of panel definitions'),
  }),
  output: z.object({
    uid: z.string().describe('Dashboard UID'),
    url: z.string().describe('Dashboard URL path'),
    version: z.number().describe('Dashboard version number'),
    status: z.string().describe('Save status'),
  }),
  async handle(params) {
    let panels: unknown = [];
    if (params.panels) {
      try {
        panels = JSON.parse(params.panels);
      } catch {
        throw ToolError.validation('panels must be a valid JSON array');
      }
    }

    const result = await api<SaveDashboardResponse>('/dashboards/db', {
      method: 'POST',
      body: {
        dashboard: {
          title: params.title,
          tags: params.tags ?? [],
          panels,
          schemaVersion: 39,
        },
        folderUid: params.folder_uid,
        overwrite: false,
      },
    });

    return {
      uid: result.uid,
      url: result.url,
      version: result.version,
      status: result.status,
    };
  },
});
