import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { testApi } from '../test-api.js';

export const failingTool = defineTool({
  name: 'failing_tool',
  displayName: 'Failing Tool',
  description:
    'A tool that always fails — calls a server endpoint that returns an error, testing ToolError propagation through the full dispatch stack',
  summary: 'A tool that always fails',
  icon: 'wrench',
  group: 'Data',
  input: z.object({
    error_code: z
      .string()
      .optional()
      .describe('The error code the server should return (default "deliberate_failure")'),
    error_message: z
      .string()
      .optional()
      .describe('The error message the server should return (default "This tool always fails")'),
  }),
  output: z.object({
    ok: z.boolean().describe('Always false — this tool is designed to fail'),
  }),
  handle: async params => {
    return await testApi('/api/fail', {
      error_code: params.error_code ?? 'deliberate_failure',
      error_message: params.error_message ?? 'This tool always fails',
    });
  },
});
