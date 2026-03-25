import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawChatSession, type RawGatewayModel, chatSessionSchema, mapChatSession } from './schemas.js';

interface ChatSessionRouteData {
  chatSession?: RawChatSession;
  availableHostedLlmModels?: RawGatewayModel[];
}

export const getChatSessionTool = defineTool({
  name: 'get_chat_session',
  displayName: 'Get Chat Session',
  description: 'Get details about a specific chat session including title, model, project, and reasoning effort.',
  summary: 'Get details about a chat session',
  icon: 'message-square',
  group: 'Chat',
  input: z.object({
    uid: z.string().describe('Chat session UID'),
  }),
  output: z.object({
    chat: chatSessionSchema.describe('Chat session details'),
    availableModels: z.array(z.string().describe('Model name')).describe('Available LLM models for this chat'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<ChatSessionRouteData>(
      `/chat/${params.uid}`,
      'routes/_authenticated/_app/chat/~uid/_index/_route',
    );

    const chat = mapChatSession(data.chatSession ?? {});
    const availableModels = (data.availableHostedLlmModels ?? []).map(m => m.name ?? '');

    return { chat, availableModels };
  },
});
