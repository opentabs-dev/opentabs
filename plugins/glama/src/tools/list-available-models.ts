import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawGatewayModel, gatewayModelSchema, mapGatewayModel } from './schemas.js';

interface ChatRouteData {
  availableHostedLlmModels?: RawGatewayModel[];
}

export const listAvailableModelsTool = defineTool({
  name: 'list_available_models',
  displayName: 'List Available Models',
  description: 'List available LLM models for chat via the Glama gateway.',
  summary: 'List available LLM models for chat',
  icon: 'cpu',
  group: 'Gateway',
  input: z.object({}),
  output: z.object({
    models: z.array(gatewayModelSchema).describe('Available gateway LLM models'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<ChatRouteData>('/chat', 'routes/_authenticated/_app/chat/~uid/_index/_route', {
      requireAuth: true,
    });

    const models = (data.availableHostedLlmModels ?? []).map(mapGatewayModel);
    return { models };
  },
});
