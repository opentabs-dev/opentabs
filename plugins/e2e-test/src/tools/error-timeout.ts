import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorTimeout = defineTool({
  name: 'error_timeout',
  displayName: 'Error: Timeout',
  description: 'Always throws ToolError.timeout() — tests structured timeout error propagation',
  summary: 'Throw a timeout error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.timeout('Operation timed out after 30s');
  },
});
