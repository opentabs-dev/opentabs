import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorNotFound = defineTool({
  name: 'error_not_found',
  displayName: 'Error: Not Found',
  description: 'Always throws ToolError.notFound() — tests structured not-found error propagation',
  summary: 'Throw a not-found error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.notFound('Resource does not exist');
  },
});
