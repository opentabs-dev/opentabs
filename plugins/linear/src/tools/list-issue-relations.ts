import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

const relationSchema = z.object({
  id: z.string().describe('Relation UUID'),
  type: z.string().describe('Relation type (blocks, blocked_by, related, duplicate)'),
  related_issue: z.object({
    id: z.string().describe('Related issue UUID'),
    identifier: z.string().describe('Human-readable identifier (e.g. ENG-123)'),
    title: z.string().describe('Issue title'),
    state: z.string().describe('Current workflow state name'),
  }),
});

const RELATION_FIELDS = `
  relations {
    nodes {
      id type
      relatedIssue {
        id identifier title
        state { name }
      }
    }
  }
`;

export const listIssueRelations = defineTool({
  name: 'list_issue_relations',
  displayName: 'List Issue Relations',
  description: 'List relations (blocks, is blocked by, relates to, duplicate of) for a Linear issue.',
  summary: 'List issue dependencies and relations',
  icon: 'link',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID or human-readable identifier (e.g. "ENG-123")'),
  }),
  output: z.object({
    relations: z.array(relationSchema).describe('List of relations for the issue'),
  }),
  handle: async params => {
    const isIdentifier = /^[A-Z]+-\d+$/i.test(params.issue_id);

    if (isIdentifier) {
      const data = await graphql<{
        searchIssues: {
          nodes: Array<{
            relations: {
              nodes: Array<Record<string, unknown>>;
            };
          }>;
        };
      }>(
        `query ListIssueRelationsByIdentifier($identifier: String!) {
          searchIssues(term: $identifier, first: 1) {
            nodes {
              ${RELATION_FIELDS}
            }
          }
        }`,
        { identifier: params.issue_id },
      );

      const node = data.searchIssues?.nodes?.[0];
      if (!node) throw ToolError.notFound(`Issue not found: ${params.issue_id}`);

      return {
        relations: (node.relations?.nodes ?? []).map(mapRelation),
      };
    }

    const data = await graphql<{
      issue: {
        relations: {
          nodes: Array<Record<string, unknown>>;
        };
      };
    }>(
      `query ListIssueRelations($id: String!) {
        issue(id: $id) {
          ${RELATION_FIELDS}
        }
      }`,
      { id: params.issue_id },
    );

    if (!data.issue) throw ToolError.notFound('Issue not found');

    return {
      relations: (data.issue.relations?.nodes ?? []).map(mapRelation),
    };
  },
});

interface RawRelation {
  id?: string;
  type?: string;
  relatedIssue?: {
    id?: string;
    identifier?: string;
    title?: string;
    state?: { name?: string };
  };
}

const mapRelation = (r: RawRelation) => ({
  id: r?.id ?? '',
  type: r?.type ?? '',
  related_issue: {
    id: r?.relatedIssue?.id ?? '',
    identifier: r?.relatedIssue?.identifier ?? '',
    title: r?.relatedIssue?.title ?? '',
    state: r?.relatedIssue?.state?.name ?? '',
  },
});
