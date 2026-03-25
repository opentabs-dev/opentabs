import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';

interface GatewayModelsRouteData {
  llmModelProfiles: Array<{
    model?: string;
    author?: { displayName?: string; name?: string };
    provider?: { displayName?: string; name?: string };
    capabilities?: string[];
    maxTokens?: { input?: number; output?: number };
    pricePerToken?: { input?: string; output?: string };
  }>;
}

const gatewayModelDetailSchema = z.object({
  model: z.string().describe('Model name/ID (e.g. "claude-sonnet-4-6")'),
  author: z.string().describe('Model author (e.g. "Anthropic")'),
  provider: z.string().describe('Provider name (e.g. "Google Vertex")'),
  capabilities: z.array(z.string()).describe('Model capabilities (e.g. "input:text", "function_calling")'),
  maxInputTokens: z.number().int().describe('Maximum input tokens'),
  maxOutputTokens: z.number().int().describe('Maximum output tokens'),
  inputPricePerToken: z.string().describe('Price per input token in USD'),
  outputPricePerToken: z.string().describe('Price per output token in USD'),
});

export const listGatewayModels = defineTool({
  name: 'list_gateway_models',
  displayName: 'List Gateway Models',
  description:
    'List LLM models available through the Glama gateway. Returns model names, authors, providers, capabilities, token limits, and pricing.',
  summary: 'List LLM models available through the Glama gateway',
  icon: 'cpu',
  group: 'Gateway',
  input: z.object({}),
  output: z.object({
    models: z.array(gatewayModelDetailSchema).describe('Available LLM models'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<GatewayModelsRouteData>(
      '/gateway/models',
      'routes/_public/gateway/models/_index/_route',
    );

    const models = (data.llmModelProfiles ?? []).map(m => ({
      model: m.model ?? '',
      author: m.author?.displayName ?? m.author?.name ?? '',
      provider: m.provider?.displayName ?? m.provider?.name ?? '',
      capabilities: m.capabilities ?? [],
      maxInputTokens: m.maxTokens?.input ?? 0,
      maxOutputTokens: m.maxTokens?.output ?? 0,
      inputPricePerToken: m.pricePerToken?.input ?? '',
      outputPricePerToken: m.pricePerToken?.output ?? '',
    }));

    return { models };
  },
});
