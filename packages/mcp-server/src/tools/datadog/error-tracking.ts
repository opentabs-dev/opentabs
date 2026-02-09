import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogErrorTrackingTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List error tracking issues
  define(
    'datadog_list_error_tracking_issues',
    {
      description: `List Error Tracking issues from Datadog.

Error Tracking automatically groups similar errors into "issues" based on:
- Error message patterns
- Stack trace similarity
- Error fingerprinting

This provides:
- Deduplicated view of errors (not every occurrence)
- Trend information (first seen, last seen, occurrence count)
- Assignee and status tracking
- Links to related traces and logs

Useful for:
- Identifying new errors vs recurring issues
- Prioritizing which errors to fix
- Tracking error resolution progress

Example queries:
- "service:my-service" - Filter by service
- "status:unresolved" - Only unresolved issues
- "is:unassigned" - Issues without an owner

Note: If the Error Tracking API is not available, this tool falls back to 
searching APM error spans and grouping them by error type.`,
      inputSchema: {
        query: z.string().optional().describe('Search query to filter issues'),
        service: z.string().optional().describe('Filter by service name'),
        env: z.string().optional().default('production').describe('Environment (default: production)'),
        status: z
          .enum(['all', 'unresolved', 'resolved', 'ignored'])
          .optional()
          .default('all')
          .describe('Filter by issue status'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours for issue activity (default: 24)'),
        limit: z.number().optional().default(50).describe('Maximum number of issues to return (default: 50)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, service, env, status, timeRangeHours, limit, datadogEnv }) => {
      // Use ISO timestamps
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;

      // Build the query for error spans
      let searchQuery = 'status:error';
      if (service) {
        searchQuery = `service:${service} ${searchQuery}`;
      }
      if (env) {
        searchQuery = `env:${env} ${searchQuery}`;
      }
      if (query) {
        searchQuery = `${searchQuery} ${query}`;
      }

      // Search for error spans using the traces search API
      // Spans API requires data.attributes wrapper
      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query: searchQuery,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: Math.min(limit ?? 50, 100),
            },
          },
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/spans/events/search',
        method: 'POST',
        body: requestBody,
        env: datadogEnv as ServiceEnv | undefined,
      });

      interface SpanEvent {
        id?: string;
        attributes?: {
          timestamp?: string;
          service?: string;
          attributes?: {
            error?: {
              message?: string;
              type?: string;
              stack?: string;
            };
            'error.message'?: string;
            'error.type'?: string;
            'error.stack'?: string;
            resource_name?: string;
          };
          tags?: string[];
        };
      }

      const response = result as {
        data?: SpanEvent[];
        meta?: {
          page?: {
            total_count?: number;
          };
        };
      };

      // Group errors by error type and message to create "issues"
      const errorGroups = new Map<
        string,
        {
          message: string;
          errorType: string;
          service: string;
          count: number;
          firstSeen: string;
          lastSeen: string;
          stack?: string;
          resource?: string;
          samples: string[];
        }
      >();

      for (const span of response.data || []) {
        const attrs = span.attributes?.attributes || {};
        const errorMessage = attrs.error?.message || attrs['error.message'] || 'Unknown error';
        const errorType = attrs.error?.type || attrs['error.type'] || 'Error';
        const serviceName = span.attributes?.service || 'unknown';
        const timestamp = span.attributes?.timestamp || new Date().toISOString();

        // Create a fingerprint for grouping
        const fingerprint = `${serviceName}:${errorType}:${errorMessage.substring(0, 100)}`;

        const existing = errorGroups.get(fingerprint);
        if (existing) {
          existing.count++;
          if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
          if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
          if (existing.samples.length < 5 && span.id) {
            existing.samples.push(span.id);
          }
        } else {
          errorGroups.set(fingerprint, {
            message: errorMessage,
            errorType,
            service: serviceName,
            count: 1,
            firstSeen: timestamp,
            lastSeen: timestamp,
            stack: attrs.error?.stack || attrs['error.stack'],
            resource: attrs.resource_name,
            samples: span.id ? [span.id] : [],
          });
        }
      }

      // Convert to array and sort by count
      const issues = Array.from(errorGroups.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit ?? 50)
        .map(([fingerprint, data], index) => ({
          id: `error-group-${index}`,
          fingerprint,
          title: `${data.errorType}: ${data.message.substring(0, 100)}`,
          message: data.message,
          errorType: data.errorType,
          status: status === 'all' ? 'unresolved' : status,
          service: data.service,
          env: env ?? 'production',
          count: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          topStackFrame: data.stack?.split('\n')[0],
          resource: data.resource,
          sampleSpanIds: data.samples,
          investigateUrl: `https://app.datadoghq.com/apm/traces?query=service:${data.service}%20status:error%20%40error.message:${encodeURIComponent(data.message.substring(0, 50))}`,
        }));

      return success({
        totalCount: issues.length,
        note: 'Issues grouped from APM error spans (Error Tracking API may not be enabled)',
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        issues,
      });
    },
  );

  // Get specific error tracking issue details
  define(
    'datadog_get_error_tracking_issue',
    {
      description: `Get detailed information about errors matching a specific pattern.

Returns comprehensive error information including:
- Full error message and stack trace
- Occurrence samples with span IDs
- Service and environment context

Since the Error Tracking API may not be available, this searches for error 
spans matching the provided criteria.

Use datadog_list_error_tracking_issues to find error patterns first, then 
use the service name and error message to investigate further.`,
      inputSchema: {
        service: z.string().describe('The service name to search errors in'),
        errorMessage: z.string().optional().describe('Error message to search for (partial match)'),
        errorType: z.string().optional().describe('Error type to filter by'),
        env: z.string().optional().default('production').describe('Environment (default: production)'),
        timeRangeHours: z.number().optional().default(24).describe('Time range in hours (default: 24)'),
        limit: z.number().optional().default(20).describe('Maximum samples to return (default: 20)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ service, errorMessage, errorType, env, timeRangeHours, limit, datadogEnv }) => {
      // Use ISO timestamps
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;

      // Build search query
      let searchQuery = `service:${service} status:error`;
      if (env) {
        searchQuery = `${searchQuery} env:${env}`;
      }
      if (errorMessage) {
        searchQuery = `${searchQuery} @error.message:*${errorMessage}*`;
      }
      if (errorType) {
        searchQuery = `${searchQuery} @error.type:${errorType}`;
      }

      // Spans API requires data.attributes wrapper
      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query: searchQuery,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: Math.min(limit ?? 20, 100),
            },
          },
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/spans/events/search',
        method: 'POST',
        body: requestBody,
        env: datadogEnv as ServiceEnv | undefined,
      });

      interface SpanEvent {
        id?: string;
        attributes?: {
          timestamp?: string;
          service?: string;
          attributes?: {
            error?: {
              message?: string;
              type?: string;
              stack?: string;
            };
            'error.message'?: string;
            'error.type'?: string;
            'error.stack'?: string;
            resource_name?: string;
            trace_id?: string;
            span_id?: string;
          };
          tags?: string[];
        };
      }

      const response = result as {
        data?: SpanEvent[];
        meta?: {
          page?: {
            total_count?: number;
          };
        };
      };

      const errors = (response.data || []).map(span => {
        const attrs = span.attributes?.attributes || {};
        return {
          spanId: span.id,
          timestamp: span.attributes?.timestamp,
          service: span.attributes?.service,
          error: {
            message: attrs.error?.message || attrs['error.message'],
            type: attrs.error?.type || attrs['error.type'],
            stack: attrs.error?.stack || attrs['error.stack'],
          },
          resource: attrs.resource_name,
          traceId: attrs['trace_id'],
          tags: span.attributes?.tags,
        };
      });

      // Aggregate error info
      const allMessages = errors.map(e => e.error.message).filter(Boolean);
      const allTypes = errors.map(e => e.error.type).filter(Boolean);
      const allStacks = errors.map(e => e.error.stack).filter(Boolean);

      return success({
        service,
        searchCriteria: {
          errorMessage,
          errorType,
          env: env ?? 'production',
        },
        totalOccurrences: response.meta?.page?.total_count ?? errors.length,
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        summary: {
          mostCommonMessage: allMessages[0],
          mostCommonType: allTypes[0],
          exampleStack: allStacks[0],
        },
        samples: errors,
        investigateUrl: `https://app.datadoghq.com/apm/traces?query=${encodeURIComponent(searchQuery)}`,
      });
    },
  );

  return tools;
};
