import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discoverQueryId, graphql } from '../github-api.js';
import { labelSchema } from './schemas.js';

const LABEL_QUERY_NAME = 'RepositoryLabelIndexPageQuery';

interface LabelNode {
  id?: string;
  name?: string;
  color?: string;
  description?: string | null;
}

interface LabelQueryResult {
  repository: {
    labels: {
      edges: Array<{ node: LabelNode }>;
      pageInfo: { endCursor: string; hasNextPage: boolean };
    };
  };
}

export const listLabels = defineTool({
  name: 'list_labels',
  displayName: 'List Labels',
  description: 'List all labels for a repository. Returns label names, colors, and descriptions.',
  summary: 'List labels for a repository',
  icon: 'tag',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
  }),
  output: z.object({
    labels: z.array(labelSchema).describe('List of labels'),
  }),
  handle: async params => {
    const queryId = await discoverQueryId(LABEL_QUERY_NAME, `/${params.owner}/${params.repo}/labels`);

    const data = await graphql<LabelQueryResult>(queryId, {
      owner: params.owner,
      name: params.repo,
      first: 100,
      skip: 0,
    });

    const edges = data?.repository?.labels?.edges ?? [];
    const labels = edges.map(e => ({
      id: 0, // GraphQL returns string IDs, not numeric
      name: e.node?.name ?? '',
      color: e.node?.color ?? '',
      description: e.node?.description ?? '',
    }));

    return { labels };
  },
});
