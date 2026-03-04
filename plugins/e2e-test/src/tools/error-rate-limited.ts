import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorRateLimited = defineTool({
  name: 'error_rate_limited',
  displayName: 'Error: Rate Limited',
  description:
    'Always throws ToolError.rateLimited() with retryAfterMs — tests structured rate limit error propagation',
  summary: 'Throw a rate-limited error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.rateLimited('Too many requests — slow down', 5000);
  },
});
