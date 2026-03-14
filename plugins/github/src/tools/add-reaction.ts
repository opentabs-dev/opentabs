import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMutationId, graphql } from '../github-api.js';

// Map from user-friendly names to GitHub GraphQL ReactionContent enum values
const REACTION_MAP: Record<string, string> = {
  '+1': 'THUMBS_UP',
  '-1': 'THUMBS_DOWN',
  laugh: 'LAUGH',
  confused: 'CONFUSED',
  heart: 'HEART',
  hooray: 'HOORAY',
  rocket: 'ROCKET',
  eyes: 'EYES',
};

export const addReaction = defineTool({
  name: 'add_reaction',
  displayName: 'Add Reaction',
  description:
    'Add a reaction to an issue, pull request, or comment. Requires the node ID of the subject (e.g., from get_issue or get_pull_request).',
  summary: 'Add a reaction to an issue or comment',
  icon: 'smile-plus',
  group: 'Reactions',
  input: z.object({
    subject_id: z
      .string()
      .min(1)
      .describe('Node ID of the issue, PR, or comment to react to (e.g., "I_kwDOBPD3oc7y2-NQ", "IC_kwDOBPD3oc7xkPTu")'),
    content: z
      .enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'])
      .describe('Reaction emoji name'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reaction was added'),
  }),
  handle: async params => {
    const reactionContent = REACTION_MAP[params.content];
    if (!reactionContent) throw ToolError.validation(`Unknown reaction: ${params.content}`);

    const mutationId = await getMutationId('addReactionMutation');
    await graphql(mutationId, {
      input: {
        subjectId: params.subject_id,
        content: reactionContent,
      },
    });

    return { success: true };
  },
});
