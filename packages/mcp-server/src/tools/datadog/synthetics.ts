import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogSyntheticsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List synthetics tests
  defineTool(
    tools,
    server,
    'datadog_list_synthetics_tests',
    {
      description: `List Synthetic monitoring tests.

Synthetic tests simulate user interactions to:
- **API tests**: Monitor HTTP endpoints, SSL certs, DNS, WebSocket, etc.
- **Browser tests**: Simulate real user browser interactions
- **Mobile tests**: Test mobile app flows

Returns test metadata including status, locations, and recent pass/fail rates.

Useful for:
- Finding tests related to a service
- Checking if synthetic monitors are passing
- Understanding test coverage`,
      inputSchema: {
        type: z.enum(['api', 'browser', 'all']).optional().describe('Filter by test type (default: all)'),
        search: z.string().optional().describe('Search tests by name'),
        tags: z.string().optional().describe('Filter by tags (comma-separated)'),
        limit: z.number().optional().default(50).describe('Maximum tests to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ type, search, tags, limit, env }) => {
      const params: Record<string, string> = {
        page_size: String(limit ?? 50),
      };

      if (search) params.text = search;
      if (tags) params.tags = tags;

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/synthetics/tests',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        tests?: Array<{
          public_id?: string;
          name?: string;
          status?: string;
          type?: string;
          subtype?: string;
          tags?: string[];
          created_at?: string;
          modified_at?: string;
          message?: string;
          locations?: string[];
          config?: {
            assertions?: unknown[];
            request?: {
              method?: string;
              url?: string;
            };
          };
          options?: {
            min_failure_duration?: number;
            min_location_failed?: number;
            tick_every?: number;
          };
          monitor_id?: number;
        }>;
      };

      // Filter by type if specified
      let tests = response.tests || [];
      if (type && type !== 'all') {
        tests = tests.filter(t => t.type === type);
      }

      const formattedTests = tests.map(test => ({
        id: test.public_id,
        name: test.name,
        status: test.status,
        type: test.type,
        subtype: test.subtype,
        tags: test.tags,
        locations: test.locations,
        monitorId: test.monitor_id,
        createdAt: test.created_at,
        modifiedAt: test.modified_at,
        message: test.message,
        config: test.config?.request
          ? {
              method: test.config.request.method,
              url: test.config.request.url,
            }
          : undefined,
        options: test.options
          ? {
              checkEverySeconds: test.options.tick_every,
              minFailureDuration: test.options.min_failure_duration,
              minLocationsFailed: test.options.min_location_failed,
            }
          : undefined,
      }));

      return success({
        count: formattedTests.length,
        tests: formattedTests,
      });
    },
  );

  // Get synthetics test details
  defineTool(
    tools,
    server,
    'datadog_get_synthetics_test',
    {
      description: `Get detailed information about a specific Synthetic test.

Returns full test configuration including:
- Request/browser configuration
- Assertions and validations
- Locations and scheduling
- Alert conditions

Use datadog_list_synthetics_tests to find test IDs.`,
      inputSchema: {
        testId: z.string().describe('The test public ID (e.g., "abc-123-xyz")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ testId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/synthetics/tests/${testId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get synthetics test results
  defineTool(
    tools,
    server,
    'datadog_get_synthetics_test_results',
    {
      description: `Get recent results for a Synthetic test.

Returns execution history including:
- Pass/fail status
- Response times
- Error messages for failures
- Results by location

Useful for:
- Debugging failing synthetic tests
- Understanding performance trends
- Finding when failures started`,
      inputSchema: {
        testId: z.string().describe('The test public ID (e.g., "abc-123-xyz")'),
        limit: z.number().optional().default(20).describe('Number of results to return (default: 20)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ testId, limit, env }) => {
      // First get the test to know its type
      const testResult = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/synthetics/tests/${testId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      const test = testResult as { type?: string };
      const testType = test.type || 'api';

      // Get results based on test type
      const resultsEndpoint =
        testType === 'browser'
          ? `/api/v1/synthetics/tests/browser/${testId}/results`
          : `/api/v1/synthetics/tests/${testId}/results`;

      const params: Record<string, string> = {};
      if (limit) params.count = String(limit);

      const result = await sendServiceRequest('datadog', {
        endpoint: resultsEndpoint,
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        results?: Array<{
          result_id?: string;
          status?: number;
          check_time?: number;
          probe_dc?: string;
          result?: {
            passed?: boolean;
            timings?: {
              dns?: number;
              tcp?: number;
              ssl?: number;
              firstByte?: number;
              download?: number;
              total?: number;
            };
            response?: {
              status?: number;
              statusText?: string;
              headers?: Record<string, string>;
            };
            errorMessage?: string;
            errorCode?: string;
            assertionResults?: Array<{
              passed?: boolean;
              type?: string;
              target?: unknown;
              actual?: unknown;
            }>;
          };
        }>;
      };

      const formattedResults = (response.results || []).map(r => ({
        resultId: r.result_id,
        passed: r.result?.passed ?? r.status === 0,
        checkTime: r.check_time ? new Date(r.check_time * 1000).toISOString() : undefined,
        location: r.probe_dc,
        timings: r.result?.timings,
        response: r.result?.response
          ? {
              status: r.result.response.status,
              statusText: r.result.response.statusText,
            }
          : undefined,
        error: r.result?.errorMessage
          ? {
              message: r.result.errorMessage,
              code: r.result.errorCode,
            }
          : undefined,
        assertionResults: r.result?.assertionResults,
      }));

      // Calculate summary
      const passed = formattedResults.filter(r => r.passed).length;
      const failed = formattedResults.filter(r => !r.passed).length;

      return success({
        testId,
        testType,
        summary: {
          total: formattedResults.length,
          passed,
          failed,
          passRate: formattedResults.length > 0 ? `${Math.round((passed / formattedResults.length) * 100)}%` : 'N/A',
        },
        results: formattedResults,
      });
    },
  );

  return tools;
};
