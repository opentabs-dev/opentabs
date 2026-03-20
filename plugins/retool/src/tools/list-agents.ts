import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawAgent, agentSchema, mapAgent } from './schemas.js';

export const listAgents = defineTool({
  name: 'list_agents',
  displayName: 'List Agents',
  description: 'List all AI agents in the Retool organization. Agents are AI-powered assistants built within Retool.',
  summary: 'List all Retool AI agents',
  icon: 'bot',
  group: 'Agents',
  input: z.object({}),
  output: z.object({
    agents: z.array(agentSchema).describe('List of agents'),
  }),
  handle: async () => {
    const data = await api<{ agents: RawAgent[] }>('/api/agents');
    return { agents: (data.agents ?? []).map(mapAgent) };
  },
});
