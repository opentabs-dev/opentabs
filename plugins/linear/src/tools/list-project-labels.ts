import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { labelSchema, mapLabel } from './schemas.js';

export const listProjectLabels = defineTool({
  name: 'list_project_labels',
  displayName: 'List Project Labels',
  description: 'List labels applied to a specific Linear project.',
  summary: 'List labels on a project',
  icon: 'tag',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to list labels for'),
  }),
  output: z.object({
    labels: z.array(labelSchema).describe('List of labels on the project'),
  }),
  handle: async params => {
    const data = await graphql<{
      project: {
        labels: {
          nodes: Record<string, unknown>[];
        };
      };
    }>(
      `query ListProjectLabels($id: String!) {
        project(id: $id) {
          labels {
            nodes {
              id name color description isGroup
              parent { name }
            }
          }
        }
      }`,
      { id: params.project_id },
    );

    if (!data.project) throw ToolError.notFound('Project not found');

    return {
      labels: (data.project.labels?.nodes ?? []).map(n => mapLabel(n as Parameters<typeof mapLabel>[0])),
    };
  },
});
