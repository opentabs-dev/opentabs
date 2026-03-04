import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const errorCustomCode = defineTool({
  name: 'error_custom_code',
  displayName: 'Error: Custom Code',
  description: 'Throws ToolError with custom error codes — tests custom code propagation',
  summary: 'Throw an error with a custom code',
  icon: 'alert-triangle',
  input: z.object({
    factory: z
      .enum(['auth', 'not_found', 'rate_limited', 'validation', 'timeout', 'internal'])
      .describe('Which error category to throw with a custom code'),
  }),
  output: z.object({ ok: z.boolean() }),
  handle: async params => {
    switch (params.factory) {
      case 'auth':
        throw ToolError.auth('Custom auth error', 'CUSTOM_AUTH');
      case 'not_found':
        throw ToolError.notFound('Custom not found', 'CUSTOM_NOT_FOUND');
      case 'rate_limited':
        throw ToolError.rateLimited('Custom rate limit', 3000, 'CUSTOM_RATE_LIMIT');
      case 'validation':
        throw ToolError.validation('Custom validation', 'CUSTOM_VALIDATION');
      case 'timeout':
        throw ToolError.timeout('Custom timeout', 'CUSTOM_TIMEOUT');
      case 'internal':
        throw ToolError.internal('Custom internal', 'CUSTOM_INTERNAL');
    }
  },
});
