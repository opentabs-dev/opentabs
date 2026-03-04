import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorInternal = defineTool({
  name: 'error_internal',
  displayName: 'Error: Internal',
  description: 'Always throws ToolError.internal() — tests structured internal error propagation',
  summary: 'Throw an internal error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.internal('Unexpected server error');
  },
});
