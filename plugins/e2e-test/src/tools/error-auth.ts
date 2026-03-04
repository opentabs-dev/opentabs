import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorAuth = defineTool({
  name: 'error_auth',
  displayName: 'Error: Auth',
  description: 'Always throws ToolError.auth() — tests structured auth error propagation',
  summary: 'Throw an auth error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.auth('Not authenticated — session expired');
  },
});
