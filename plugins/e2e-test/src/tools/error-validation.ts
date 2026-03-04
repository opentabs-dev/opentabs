import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorValidation = defineTool({
  name: 'error_validation',
  displayName: 'Error: Validation',
  description: 'Always throws ToolError.validation() — tests structured validation error propagation',
  summary: 'Throw a validation error',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({}),
  handle: async () => {
    throw ToolError.validation('Invalid input: name must be non-empty');
  },
});
