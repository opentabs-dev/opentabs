import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// Helper types for trace data from the internal API
interface InternalSpan {
  trace_id?: string;
  span_id?: string;
  parent_id?: string;
  name?: string;
  service?: string;
  resource?: string;
  resource_hash?: string;
  type?: string;
  start?: number;
  end?: number;
  duration?: number;
  error?: number;
  status?: string;
  hostname?: string;
  host_id?: number;
  env?: string;
  host_groups?: string[];
  ingestion_reason?: string;
  meta?: Record<string, string>;
  metrics?: Record<string, number>;
  children_ids?: string[];
}

interface InternalSpanTree {
  root_id: string;
  spans: Record<string, InternalSpan>;
}

interface InternalTraceResponse {
  trace?: InternalSpanTree;
  orphaned?: InternalSpanTree[];
}

interface FormattedSpan {
  spanId: string;
  parentId: string | null;
  service: string;
  name: string;
  resource: string;
  type: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  hasError: boolean;
  status?: string;
  hostname?: string;
  env?: string;
  errorMessage?: string;
  errorType?: string;
  errorStack?: string;
  httpMethod?: string;
  httpUrl?: string;
  httpStatusCode?: string;
  httpRoute?: string;
  grpcMethod?: string;
  grpcStatusCode?: string;
  dbStatement?: string;
  dbSystem?: string;
  graphqlOperation?: string;
  graphqlOperationType?: string;
  userId?: string;
  customerId?: string;
  brexRequestId?: string;
  gitCommit?: string;
  podName?: string;
  kubeDeployment?: string;
  team?: string;
  ingestionReason?: string;
  children: FormattedSpan[];
}

// Helper function to format an internal span with rich metadata
const formatInternalSpan = (span: InternalSpan): FormattedSpan => {
  const meta = span.meta || {};
  const formatted: FormattedSpan = {
    spanId: span.span_id || '',
    parentId: span.parent_id && span.parent_id !== '0' ? span.parent_id : null,
    service: span.service || '',
    name: span.name || '',
    resource: span.resource || '',
    type: span.type || '',
    startTime: span.start ? new Date(span.start * 1000).toISOString() : '',
    endTime: span.end ? new Date(span.end * 1000).toISOString() : undefined,
    durationMs: span.duration ? span.duration * 1000 : 0, // Internal API returns seconds
    hasError: span.error === 1 || span.status === 'error',
    status: span.status,
    hostname: span.hostname,
    env: span.env,
    ingestionReason: span.ingestion_reason,
    children: [],
  };

  // Extract error details
  if (formatted.hasError) {
    formatted.errorMessage = meta['error.message'] || meta['error.msg'] || meta['error.type'];
    formatted.errorType = meta['error.type'];
    formatted.errorStack = meta['error.stack'];
  }

  // HTTP metadata
  formatted.httpMethod = meta['http.method'];
  formatted.httpUrl = meta['http.url'] || meta['http.url_details.path'];
  formatted.httpStatusCode = meta['http.status_code'];
  formatted.httpRoute = meta['http.route'];

  // gRPC metadata
  formatted.grpcMethod = meta['rpc.method'] || meta['grpc.method'];
  formatted.grpcStatusCode = meta['rpc.grpc.status_code'] || meta['grpc.status.code'];

  // Database metadata
  formatted.dbStatement = meta['db.statement'] || meta['sql.query'];
  formatted.dbSystem = meta['db.system'];

  // GraphQL metadata
  formatted.graphqlOperation = meta['operationName'] || meta['graphql.operation.name'];
  formatted.graphqlOperationType = meta['operationType'] || meta['graphql.operation.type'];

  // Identity and request context
  formatted.userId =
    meta['identity.customer_identity_context.customer_user_id'] || meta['usr.id'] || meta['usr.customerUserId'];
  formatted.customerId =
    meta['identity.customer_identity_context.customer_account_id'] ||
    meta['usr.companyId'] ||
    meta['usr.customerAccountId'];
  formatted.brexRequestId = meta['brex_request_id'];

  // Deployment metadata
  formatted.gitCommit = meta['git.commit.sha'] || meta['version'];
  formatted.podName = meta['pod_name'];
  formatted.kubeDeployment = meta['kube_deployment'];
  formatted.team = meta['team'];

  return formatted;
};

// Helper function to build span tree from internal API response
const buildSpanTreeFromInternal = (
  traceData: InternalTraceResponse,
): { mainTree: FormattedSpan[]; orphanedTrees: FormattedSpan[][] } => {
  const buildTree = (spanTree: InternalSpanTree): FormattedSpan[] => {
    const spanMap = new Map<string, FormattedSpan>();
    const roots: FormattedSpan[] = [];

    // First pass: create formatted spans
    for (const [spanId, span] of Object.entries(spanTree.spans)) {
      const formatted = formatInternalSpan(span);
      formatted.spanId = spanId; // Ensure we use the key as span ID
      spanMap.set(spanId, formatted);
    }

    // Second pass: build tree using children_ids
    for (const [spanId, span] of Object.entries(spanTree.spans)) {
      const formattedSpan = spanMap.get(spanId);
      if (!formattedSpan) continue;

      // Add children based on children_ids array
      if (span.children_ids && span.children_ids.length > 0) {
        for (const childId of span.children_ids) {
          const child = spanMap.get(childId);
          if (child) {
            formattedSpan.children.push(child);
          }
        }
      }

      // Check if this is a root span
      if (!span.parent_id || span.parent_id === '0' || spanId === spanTree.root_id) {
        roots.push(formattedSpan);
      }
    }

    // If no roots found but we have spans, use root_id or find spans without parents
    if (roots.length === 0 && spanMap.size > 0) {
      const rootSpan = spanMap.get(spanTree.root_id);
      if (rootSpan) {
        roots.push(rootSpan);
      } else {
        // Find orphan root spans
        for (const [spanId, span] of Object.entries(spanTree.spans)) {
          const formatted = spanMap.get(spanId);
          if (formatted && (!span.parent_id || span.parent_id === '0' || !spanMap.has(span.parent_id || ''))) {
            roots.push(formatted);
          }
        }
      }
    }

    // Sort children by start time
    const sortChildren = (span: FormattedSpan): void => {
      span.children.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      span.children.forEach(sortChildren);
    };
    roots.forEach(sortChildren);

    return roots;
  };

  const mainTree = traceData.trace ? buildTree(traceData.trace) : [];
  const orphanedTrees = (traceData.orphaned || []).map(buildTree);

  return { mainTree, orphanedTrees };
};

// Helper to find error spans in the tree
const findErrorSpans = (spans: FormattedSpan[]): FormattedSpan[] => {
  const errors: FormattedSpan[] = [];

  const traverse = (span: FormattedSpan): void => {
    if (span.hasError) {
      errors.push(span);
    }
    span.children.forEach(traverse);
  };

  spans.forEach(traverse);
  return errors;
};

// Helper to flatten the tree for summary
const summarizeTrace = (
  roots: FormattedSpan[],
): {
  totalSpans: number;
  services: string[];
  totalDurationMs: number;
  errorCount: number;
  errors: Array<{
    service: string;
    name: string;
    resource: string;
    errorType?: string;
    errorMessage?: string;
    httpStatusCode?: string;
  }>;
  httpEndpoints: Array<{
    method?: string;
    route?: string;
    statusCode?: string;
    service: string;
  }>;
  graphqlOperations: Array<{
    operation?: string;
    type?: string;
    service: string;
  }>;
  databaseQueries: number;
  teams: string[];
} => {
  const services = new Set<string>();
  const teams = new Set<string>();
  let totalSpans = 0;
  let totalDuration = 0;
  let databaseQueries = 0;
  const errors: Array<{
    service: string;
    name: string;
    resource: string;
    errorType?: string;
    errorMessage?: string;
    httpStatusCode?: string;
  }> = [];
  const httpEndpoints: Array<{ method?: string; route?: string; statusCode?: string; service: string }> = [];
  const graphqlOperations: Array<{ operation?: string; type?: string; service: string }> = [];

  const traverse = (span: FormattedSpan): void => {
    totalSpans++;
    if (span.service) services.add(span.service);
    if (span.team) teams.add(span.team);
    totalDuration = Math.max(totalDuration, span.durationMs);

    if (span.hasError) {
      errors.push({
        service: span.service,
        name: span.name,
        resource: span.resource,
        errorType: span.errorType,
        errorMessage: span.errorMessage,
        httpStatusCode: span.httpStatusCode,
      });
    }

    if (span.httpRoute || span.httpUrl) {
      httpEndpoints.push({
        method: span.httpMethod,
        route: span.httpRoute || span.httpUrl,
        statusCode: span.httpStatusCode,
        service: span.service,
      });
    }

    if (span.graphqlOperation) {
      graphqlOperations.push({
        operation: span.graphqlOperation,
        type: span.graphqlOperationType,
        service: span.service,
      });
    }

    if (span.dbStatement || span.type === 'sql') {
      databaseQueries++;
    }

    span.children.forEach(traverse);
  };

  roots.forEach(traverse);

  return {
    totalSpans,
    services: [...services].filter(Boolean),
    totalDurationMs: totalDuration,
    errorCount: errors.length,
    errors,
    httpEndpoints,
    graphqlOperations,
    databaseQueries,
    teams: [...teams].filter(Boolean),
  };
};

export const registerDatadogApmTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Search traces
  defineTool(
    tools,
    server,
    'datadog_search_traces',
    {
      description: `Search APM traces/spans with a query. Returns spans matching the query within the specified time range.

Example queries:
- "service:my-service" - Find spans from a specific service
- "service:my-service env:production" - Find spans from production
- "@http.status_code:>=500" - Find spans with 5xx errors
- "resource_name:'GET /api/users'" - Find spans for a specific endpoint
- "@duration:>1000000000" - Find spans longer than 1 second (duration in nanoseconds)
- "trace_id:8029474397976343229" - Find spans by trace ID (use DECIMAL format)

Time range is specified in hours from now (default: 1 hour for traces).

IMPORTANT: When searching by trace_id, use the DECIMAL format (e.g., "8029474397976343229"), 
not the hex format. The decimal trace ID can be found in log events or span search results.`,
      inputSchema: {
        query: z.string().describe('Datadog span search query (e.g., "service:my-service env:production")'),
        timeRangeHours: z
          .number()
          .optional()
          .default(1)
          .describe('Time range in hours from now to search (default: 1)'),
        limit: z.number().optional().default(50).describe('Maximum number of spans to return (default: 50, max: 1000)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, timeRangeHours, limit, datadogEnv }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 1) * 60 * 60 * 1000;
      const effectiveLimit = Math.min(limit ?? 50, 1000);

      // API v2 requires the data wrapper format with ISO timestamps
      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: effectiveLimit,
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

      return success(result);
    },
  );

  // Get trace by ID - Enhanced with internal API for complete span data
  defineTool(
    tools,
    server,
    'datadog_get_trace',
    {
      description: `Get comprehensive trace information including ALL spans, orphaned spans, and rich metadata.

This tool uses Datadog's internal trace API to return the complete trace data that you see in the Datadog UI, including:
- **Main span tree**: The primary hierarchical trace with parent-child relationships
- **Orphaned spans**: Spans that got separated due to async processing or sampling
- **Rich metadata**: User context, HTTP details, GraphQL operations, database queries, deployment info
- **Error details**: Full error messages, types, and stack traces

The response includes:
- **summary**: Total spans, services, duration, error count, HTTP endpoints, GraphQL ops, DB query count
- **errors**: List of all error spans with details
- **userContext**: User/customer IDs extracted from RUM or backend spans
- **spanTree**: Complete hierarchical span data (if includeSpanTree=true)
- **orphanedSpans**: Spans not connected to main tree (if includeSpanTree=true)

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format (e.g., "8029474397976343229")'),
        includeSpanTree: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include the full hierarchical span tree and orphaned spans (can be large)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, includeSpanTree, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      // Check if we got valid trace data
      const hasMainTrace = result.trace && Object.keys(result.trace.spans || {}).length > 0;
      const hasOrphaned = result.orphaned && result.orphaned.length > 0;

      if (!hasMainTrace && !hasOrphaned) {
        return success({
          traceId,
          message:
            'No spans found for this trace. The trace may have expired or use datadog_search_traces with "trace_id:<id>" for span search results.',
          hint: 'Traces are typically retained for 15 days. For older traces, check logs with datadog_get_trace_logs.',
        });
      }

      // Build the span trees from internal API format
      const { mainTree, orphanedTrees } = buildSpanTreeFromInternal(result);

      // Combine all spans for summary
      const allSpans = [...mainTree, ...orphanedTrees.flat()];

      // Generate comprehensive summary
      const summary = summarizeTrace(allSpans);

      // Extract user context from spans
      let userContext: {
        userId?: string;
        customerId?: string;
        sessionId?: string;
        sessionReplayAvailable?: boolean;
        clientName?: string;
        clientVersion?: string;
      } | null = null;

      const extractUserContext = (span: FormattedSpan): void => {
        if (!userContext && (span.userId || span.customerId)) {
          userContext = {
            userId: span.userId,
            customerId: span.customerId,
          };
        }
        // Look for RUM session info in meta (need to check raw data)
        span.children.forEach(extractUserContext);
      };
      allSpans.forEach(extractUserContext);

      // Check for session replay info in raw data
      if (result.trace) {
        for (const span of Object.values(result.trace.spans)) {
          const meta = span.meta || {};
          if (meta['session.is_replay_available'] === 'true' || meta['session.has_replay'] === 'true') {
            userContext = userContext || {};
            userContext.sessionReplayAvailable = true;
            userContext.sessionId = meta['_dd.session.id'];
            userContext.clientName = meta['client.name'] || meta['application.name'];
            userContext.clientVersion = meta['client.version'] || meta['version'];
            break;
          }
        }
      }

      // Build response
      const response: {
        traceId: string;
        summary: typeof summary;
        errors: Array<{
          service: string;
          name: string;
          resource: string;
          errorType?: string;
          errorMessage?: string;
          errorStack?: string;
          httpStatusCode?: string;
          durationMs: number;
        }>;
        userContext?: typeof userContext;
        spanTree?: FormattedSpan[];
        orphanedSpans?: FormattedSpan[][];
        datadogUrl: string;
      } = {
        traceId,
        summary,
        errors: findErrorSpans(allSpans).map(span => ({
          service: span.service,
          name: span.name,
          resource: span.resource,
          errorType: span.errorType,
          errorMessage: span.errorMessage,
          errorStack: span.errorStack,
          httpStatusCode: span.httpStatusCode,
          durationMs: span.durationMs,
        })),
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      };

      if (userContext) {
        response.userContext = userContext;
      }

      // Optionally include the full span trees
      if (includeSpanTree) {
        response.spanTree = mainTree;
        if (orphanedTrees.length > 0) {
          response.orphanedSpans = orphanedTrees;
        }
      }

      return success(response);
    },
  );

  // Get logs correlated with a trace
  defineTool(
    tools,
    server,
    'datadog_get_trace_logs',
    {
      description: `Get all logs correlated with a specific trace ID.

This is a convenience tool that searches for logs containing the given trace ID,
making it easy to see all log messages associated with a distributed trace.

Useful for:
- Understanding what happened during a request
- Finding error messages and stack traces
- Debugging issues across microservices

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex format.
The decimal trace ID can be found in the "traceId" field of log search results or span data.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format (e.g., "8029474397976343229")'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours from now to search (default: 24)'),
        limit: z.number().optional().default(100).describe('Maximum number of logs to return (default: 100)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, timeRangeHours, limit, datadogEnv }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;
      const effectiveLimit = Math.min(limit ?? 100, 1000);

      const requestBody = {
        list: {
          columns: [
            { field: { path: 'status' } },
            { field: { path: 'timestamp' } },
            { field: { path: 'host' } },
            { field: { path: 'service' } },
            { field: { path: 'message' } },
          ],
          sort: {
            time: { order: 'asc' as const },
          },
          limit: effectiveLimit,
          time: {
            from,
            to: now,
          },
          search: {
            query: `trace_id:${traceId}`,
          },
          includeEvents: true,
          computeCount: false,
          indexes: ['*'],
          executionInfo: {},
        },
        querySourceId: 'mcp_trace_logs',
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/logs-analytics/list?type=logs',
        method: 'POST',
        body: requestBody,
        env: datadogEnv as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        hitCount?: number;
        status?: string;
        result?: {
          events?: Array<{
            event_id?: string;
            columns?: unknown[];
            event?: {
              message?: string;
              status?: string;
              trace_id?: string;
              span_id?: string;
              custom?: {
                error?: {
                  stack?: string;
                  message?: string;
                };
                [key: string]: unknown;
              };
            };
          }>;
        };
      };

      const events = response.result?.events || [];
      const formattedLogs = events.map(evt => ({
        id: evt.event_id,
        timestamp: evt.columns?.[1],
        host: evt.columns?.[2],
        service: evt.columns?.[3],
        message: evt.columns?.[4] ?? evt.event?.message,
        status: evt.columns?.[0] ?? evt.event?.status,
        spanId: evt.event?.span_id,
        error: evt.event?.custom?.error
          ? {
              stack: evt.event.custom.error.stack,
              message: evt.event.custom.error.message,
            }
          : undefined,
      }));

      return success({
        traceId,
        logCount: formattedLogs.length,
        logs: formattedLogs,
      });
    },
  );

  // Get service summary - uses service dependencies endpoint
  defineTool(
    tools,
    server,
    'datadog_get_service_summary',
    {
      description: `Get service dependency map for a Datadog APM service.

Returns:
- Service name
- Upstream services (called_by): which services call this one
- Downstream services (calls): which services this one depends on

Use this to understand the service topology — what depends on a service and what it depends on. For latency/error rate metrics, use datadog_search_traces or datadog_get_grpc_method_stats instead.`,
      inputSchema: {
        service: z.string().describe('The service name'),
        env: z.string().describe('Environment (e.g., "production", "staging")'),
        timeRangeHours: z.number().optional().default(1).describe('Time range in hours (default: 1)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ service, env, timeRangeHours, datadogEnv }) => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (timeRangeHours ?? 1) * 60 * 60;

      const params: Record<string, string> = {
        start: `${from}`,
        end: `${now}`,
        env,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/service_dependencies/${service}`,
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // List APM services
  defineTool(
    tools,
    server,
    'datadog_list_apm_services',
    {
      description: `List APM services from Datadog with their tracing status.

Returns a list of all services that have sent traces to Datadog in the specified environment.
This is useful for:
- Discovering what services exist in an environment
- Finding service names for further investigation
- Understanding the service landscape

Note: This returns services from APM tracing. For service catalog entries with ownership info,
use datadog_list_services instead.`,
      inputSchema: {
        env: z.string().describe('Environment to filter by (e.g., "production", "staging") - required'),
        limit: z.number().optional().default(100).describe('Maximum number of services to return (default: 100)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ env, limit, datadogEnv }) => {
      const params: Record<string, string> = {
        'filter[env]': env,
        'page[size]': String(limit ?? 100),
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/apm/services',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        data?: {
          id?: string;
          type?: string;
          attributes?: {
            services?: string[];
            metadata?: Array<{
              isTraced?: boolean;
            }>;
          };
        };
      };

      const services = response.data?.attributes?.services || [];
      const metadata = response.data?.attributes?.metadata || [];

      // Combine services with their metadata
      const formattedServices = services.map((serviceName, index) => ({
        name: serviceName,
        isTraced: metadata[index]?.isTraced ?? true,
      }));

      return success({
        environment: env,
        count: formattedServices.length,
        services: formattedServices,
      });
    },
  );

  // Get specific span details
  defineTool(
    tools,
    server,
    'datadog_get_span',
    {
      description: `Get detailed information about a specific span within a trace.

Returns comprehensive span metadata including:
- Timing: start time, end time, duration
- Context: service, operation, resource, type
- HTTP: method, URL, status code, route
- gRPC: method, status code
- Database: SQL query, system type
- GraphQL: operation name and type
- Error: message, type, stack trace
- Deployment: git commit, pod name, kubernetes deployment
- Identity: user ID, customer ID, request ID

Use this to drill into specific spans found in datadog_get_trace results.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format'),
        spanId: z.string().describe('The span ID to retrieve'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, spanId, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      // Search for the span in main trace and orphaned trees
      let foundSpan: InternalSpan | null = null;

      if (result.trace?.spans[spanId]) {
        foundSpan = result.trace.spans[spanId];
      } else if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          if (orphanTree.spans[spanId]) {
            foundSpan = orphanTree.spans[spanId];
            break;
          }
        }
      }

      if (!foundSpan) {
        return success({
          traceId,
          spanId,
          message: 'Span not found in trace. The span may have been sampled out or expired.',
        });
      }

      // Format the span with all metadata
      const formattedSpan = formatInternalSpan(foundSpan);

      // Include raw meta for additional context
      return success({
        traceId,
        span: formattedSpan,
        rawMeta: foundSpan.meta,
        rawMetrics: foundSpan.metrics,
      });
    },
  );

  // Get trace flame graph / timeline visualization
  defineTool(
    tools,
    server,
    'datadog_get_trace_flame_graph',
    {
      description: `Get a trace timeline visualization showing span timing and hierarchy.

Returns spans sorted by start time with:
- Relative timing (offset from trace start)
- Duration and percentage of total trace time
- Visual depth indicator for hierarchy
- Service and resource information
- Error markers

This is useful for:
- Understanding the critical path of a request
- Identifying slow spans and bottlenecks
- Visualizing parallel vs sequential operations
- Debugging latency issues`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format'),
        maxSpans: z.number().optional().default(100).describe('Maximum spans to include (default: 100)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, maxSpans, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      if (!result.trace && !result.orphaned) {
        return success({
          traceId,
          message: 'No trace data found',
        });
      }

      // Collect all spans
      const allSpans: Array<InternalSpan & { depth: number; isOrphaned: boolean }> = [];

      // Helper to calculate depth
      const addSpansWithDepth = (spans: Record<string, InternalSpan>, isOrphaned: boolean): void => {
        const childrenMap = new Map<string, string[]>();
        const depthMap = new Map<string, number>();

        // Build parent-child relationships
        for (const [spanId, span] of Object.entries(spans)) {
          if (span.parent_id && span.parent_id !== '0') {
            const siblings = childrenMap.get(span.parent_id) || [];
            siblings.push(spanId);
            childrenMap.set(span.parent_id, siblings);
          }
        }

        // Calculate depths
        const calculateDepth = (spanId: string, depth: number): void => {
          depthMap.set(spanId, depth);
          const children = childrenMap.get(spanId) || [];
          for (const childId of children) {
            calculateDepth(childId, depth + 1);
          }
        };

        // Find roots and calculate depths
        for (const [spanId, span] of Object.entries(spans)) {
          if (!span.parent_id || span.parent_id === '0' || !spans[span.parent_id]) {
            calculateDepth(spanId, 0);
          }
        }

        // Add spans with depth
        for (const [spanId, span] of Object.entries(spans)) {
          allSpans.push({
            ...span,
            span_id: spanId,
            depth: depthMap.get(spanId) ?? 0,
            isOrphaned,
          });
        }
      };

      if (result.trace) {
        addSpansWithDepth(result.trace.spans, false);
      }
      if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          addSpansWithDepth(orphanTree.spans, true);
        }
      }

      // Sort by start time
      allSpans.sort((a, b) => (a.start || 0) - (b.start || 0));

      // Calculate trace bounds
      const traceStart = Math.min(...allSpans.map(s => s.start || Infinity));
      const traceEnd = Math.max(...allSpans.map(s => s.end || 0));
      const totalDuration = traceEnd - traceStart;

      // Limit spans
      const limitedSpans = allSpans.slice(0, maxSpans ?? 100);

      // Format for visualization
      const timeline = limitedSpans.map(span => {
        const startOffset = ((span.start || 0) - traceStart) * 1000; // Convert to ms
        const duration = (span.duration || 0) * 1000; // Convert to ms
        const percentage = totalDuration > 0 ? ((span.duration || 0) / totalDuration) * 100 : 0;

        return {
          spanId: span.span_id,
          service: span.service,
          name: span.name,
          resource: span.resource?.substring(0, 100), // Truncate long resources
          depth: span.depth,
          depthIndicator: '  '.repeat(span.depth) + '├─',
          startOffsetMs: Math.round(startOffset * 100) / 100,
          durationMs: Math.round(duration * 100) / 100,
          percentOfTrace: Math.round(percentage * 100) / 100,
          hasError: span.error === 1 || span.status === 'error',
          isOrphaned: span.isOrphaned,
          httpStatus: span.meta?.['http.status_code'],
        };
      });

      return success({
        traceId,
        totalDurationMs: Math.round(totalDuration * 1000 * 100) / 100,
        totalSpans: allSpans.length,
        displayedSpans: timeline.length,
        timeline,
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      });
    },
  );

  // Analyze trace errors - provides root cause analysis
  defineTool(
    tools,
    server,
    'datadog_analyze_trace_errors',
    {
      description: `Analyze errors in a trace and provide root cause analysis.

This tool examines all error spans in a trace and provides:
- **Error chain**: The sequence of errors from root cause to user-facing error
- **Root cause identification**: The deepest error in the call chain (likely the original failure)
- **Impact analysis**: Which services were affected by each error
- **Suggested actions**: What to investigate based on error patterns

Use this when you have a trace with errors and want to quickly understand:
- What went wrong
- Where the problem originated
- How it propagated through the system

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format (e.g., "8029474397976343229")'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      if (!result.trace && !result.orphaned) {
        return success({
          traceId,
          message: 'No trace data found',
        });
      }

      // Collect all spans
      const allSpans: Array<InternalSpan & { spanId: string }> = [];
      if (result.trace) {
        for (const [spanId, span] of Object.entries(result.trace.spans)) {
          allSpans.push({ ...span, spanId });
        }
      }
      if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          for (const [spanId, span] of Object.entries(orphanTree.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
      }

      // Find error spans
      const errorSpans = allSpans.filter(s => s.error === 1 || s.status === 'error');

      if (errorSpans.length === 0) {
        return success({
          traceId,
          hasErrors: false,
          message: 'No errors found in this trace',
          datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
        });
      }

      // Sort errors by start time to understand sequence
      errorSpans.sort((a, b) => (a.start || 0) - (b.start || 0));

      // Build parent chain to find root causes
      const spanMap = new Map<string, (typeof allSpans)[0]>();
      allSpans.forEach(s => spanMap.set(s.spanId, s));

      // Find the deepest error (likely root cause)
      const findRootCause = (): (typeof errorSpans)[0] | null => {
        // For each error, count how many error ancestors it has
        // The error with the most error ancestors is closest to the root cause
        let deepestError = errorSpans[0];

        for (const errorSpan of errorSpans) {
          let depth = 0;
          let current = errorSpan;

          // Walk up the parent chain
          while (current.parent_id && current.parent_id !== '0') {
            const parent = spanMap.get(current.parent_id);
            if (!parent) break;
            if (parent.error === 1 || parent.status === 'error') {
              depth++;
            }
            current = parent;
          }

          // The error with fewest error ancestors but appearing first is likely root cause
          if (depth === 0 && (!deepestError || (errorSpan.start || 0) < (deepestError.start || 0))) {
            deepestError = errorSpan;
          }
        }

        // Also check if there's an error that occurred first and isn't a child of another error
        for (const errorSpan of errorSpans) {
          let hasErrorParent = false;
          let current = errorSpan;

          while (current.parent_id && current.parent_id !== '0') {
            const parent = spanMap.get(current.parent_id);
            if (!parent) break;
            if (parent.error === 1 || parent.status === 'error') {
              hasErrorParent = true;
              break;
            }
            current = parent;
          }

          if (!hasErrorParent && (errorSpan.start || 0) <= (deepestError.start || 0)) {
            deepestError = errorSpan;
          }
        }

        return deepestError;
      };

      const rootCause = findRootCause();

      // Analyze error patterns
      const errorsByType: Record<string, Array<{ service: string; message?: string; spanId: string }>> = {};
      const errorsByService: Record<string, number> = {};

      for (const errorSpan of errorSpans) {
        const errorType = errorSpan.meta?.['error.type'] || 'Unknown';
        const service = errorSpan.service || 'unknown';
        const message = errorSpan.meta?.['error.message'];

        if (!errorsByType[errorType]) {
          errorsByType[errorType] = [];
        }
        errorsByType[errorType].push({ service, message, spanId: errorSpan.spanId });

        errorsByService[service] = (errorsByService[service] || 0) + 1;
      }

      // Build error chain from root cause
      const errorChain: Array<{
        service: string;
        operation: string;
        errorType?: string;
        errorMessage?: string;
        durationMs: number;
        spanId: string;
        datadogSpanUrl: string;
      }> = [];

      if (rootCause) {
        // Start with root cause
        errorChain.push({
          service: rootCause.service || '',
          operation: rootCause.resource || rootCause.name || '',
          errorType: rootCause.meta?.['error.type'],
          errorMessage: rootCause.meta?.['error.message'],
          durationMs: (rootCause.duration || 0) * 1000,
          spanId: rootCause.spanId,
          datadogSpanUrl: `https://app.datadoghq.com/apm/trace/${traceId}?spanID=${rootCause.spanId}`,
        });

        // Find child errors
        const addChildErrors = (parentId: string): void => {
          for (const span of errorSpans) {
            if (span.parent_id === parentId && span.spanId !== rootCause.spanId) {
              errorChain.push({
                service: span.service || '',
                operation: span.resource || span.name || '',
                errorType: span.meta?.['error.type'],
                errorMessage: span.meta?.['error.message'],
                durationMs: (span.duration || 0) * 1000,
                spanId: span.spanId,
                datadogSpanUrl: `https://app.datadoghq.com/apm/trace/${traceId}?spanID=${span.spanId}`,
              });
              addChildErrors(span.spanId);
            }
          }
        };
        addChildErrors(rootCause.spanId);
      }

      // Generate suggested actions based on error patterns
      const suggestedActions: string[] = [];

      for (const [errorType, errors] of Object.entries(errorsByType)) {
        if (errorType.includes('DEADLINE_EXCEEDED') || errorType.includes('Timeout')) {
          suggestedActions.push(
            `Check for slow downstream dependencies or increase timeout for ${errors.map(e => e.service).join(', ')}`,
          );
        } else if (errorType.includes('NOT_FOUND')) {
          suggestedActions.push(
            `Verify data exists for the requested resources in ${errors.map(e => e.service).join(', ')}`,
          );
        } else if (errorType.includes('PERMISSION') || errorType.includes('UNAUTHORIZED')) {
          suggestedActions.push(
            `Check authentication/authorization configuration for ${errors.map(e => e.service).join(', ')}`,
          );
        } else if (errorType.includes('Connection') || errorType.includes('UNAVAILABLE')) {
          suggestedActions.push(
            `Check network connectivity and service health for ${errors.map(e => e.service).join(', ')}`,
          );
        }
      }

      if (suggestedActions.length === 0) {
        suggestedActions.push('Review the error stack traces in the root cause span');
        suggestedActions.push('Check logs around the time of the error using datadog_get_trace_logs');
      }

      return success({
        traceId,
        hasErrors: true,
        errorCount: errorSpans.length,
        rootCause: rootCause
          ? {
              service: rootCause.service,
              operation: rootCause.resource || rootCause.name,
              errorType: rootCause.meta?.['error.type'],
              errorMessage: rootCause.meta?.['error.message'],
              errorStack: rootCause.meta?.['error.stack'],
              spanId: rootCause.spanId,
              datadogSpanUrl: `https://app.datadoghq.com/apm/trace/${traceId}?spanID=${rootCause.spanId}`,
              timestamp: rootCause.start ? new Date(rootCause.start * 1000).toISOString() : undefined,
            }
          : null,
        errorChain: errorChain.length > 1 ? errorChain : undefined,
        errorsByService,
        errorsByType: Object.fromEntries(
          Object.entries(errorsByType).map(([type, errors]) => [
            type,
            { count: errors.length, services: [...new Set(errors.map(e => e.service))] },
          ]),
        ),
        suggestedActions,
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      });
    },
  );

  // Get slowest spans in a trace
  defineTool(
    tools,
    server,
    'datadog_get_slow_spans',
    {
      description: `Get the slowest spans in a trace for performance debugging.

This tool identifies performance bottlenecks by:
- Finding the N slowest spans by duration
- Grouping slow spans by service and operation
- Calculating percentage of total trace time consumed
- Identifying parallel vs sequential slow operations

Use this when:
- A trace is taking longer than expected
- You need to identify which services are slow
- You want to find optimization opportunities

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format (e.g., "8029474397976343229")'),
        topN: z.number().optional().default(10).describe('Number of slowest spans to return (default: 10)'),
        minDurationMs: z.number().optional().describe('Only include spans slower than this duration in milliseconds'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, topN, minDurationMs, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      if (!result.trace && !result.orphaned) {
        return success({
          traceId,
          message: 'No trace data found',
        });
      }

      // Collect all spans
      const allSpans: Array<InternalSpan & { spanId: string }> = [];
      if (result.trace) {
        for (const [spanId, span] of Object.entries(result.trace.spans)) {
          allSpans.push({ ...span, spanId });
        }
      }
      if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          for (const [spanId, span] of Object.entries(orphanTree.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
      }

      // Calculate trace duration
      const traceStart = Math.min(...allSpans.map(s => s.start || Infinity));
      const traceEnd = Math.max(...allSpans.map(s => s.end || 0));
      const traceDurationMs = (traceEnd - traceStart) * 1000;

      // Filter and sort by duration
      let filteredSpans = allSpans;
      if (minDurationMs !== undefined) {
        filteredSpans = allSpans.filter(s => (s.duration || 0) * 1000 >= minDurationMs);
      }

      const sortedSpans = filteredSpans.sort((a, b) => (b.duration || 0) - (a.duration || 0));

      const limit = topN ?? 10;
      const slowestSpans = sortedSpans.slice(0, limit);

      // Group by service
      const byService: Record<string, { totalDurationMs: number; count: number; operations: string[] }> = {};
      for (const span of slowestSpans) {
        const service = span.service || 'unknown';
        if (!byService[service]) {
          byService[service] = { totalDurationMs: 0, count: 0, operations: [] };
        }
        byService[service].totalDurationMs += (span.duration || 0) * 1000;
        byService[service].count++;
        const op = span.resource || span.name || 'unknown';
        if (!byService[service].operations.includes(op)) {
          byService[service].operations.push(op);
        }
      }

      // Group by operation type
      const byType: Record<string, { totalDurationMs: number; count: number }> = {};
      for (const span of slowestSpans) {
        const type = span.type || 'unknown';
        if (!byType[type]) {
          byType[type] = { totalDurationMs: 0, count: 0 };
        }
        byType[type].totalDurationMs += (span.duration || 0) * 1000;
        byType[type].count++;
      }

      // Format slow spans
      const formattedSlowSpans = slowestSpans.map(span => ({
        spanId: span.spanId,
        service: span.service,
        operation: span.resource || span.name,
        type: span.type,
        durationMs: Math.round((span.duration || 0) * 1000 * 100) / 100,
        percentOfTrace: Math.round(((span.duration || 0) / (traceEnd - traceStart)) * 10000) / 100,
        hasError: span.error === 1 || span.status === 'error',
        dbQuery: span.meta?.['db.statement'] ? span.meta['db.statement'].substring(0, 200) : undefined,
        httpEndpoint: span.meta?.['http.route'] || span.meta?.['http.url'],
        grpcMethod: span.meta?.['rpc.method'],
        datadogSpanUrl: `https://app.datadoghq.com/apm/trace/${traceId}?spanID=${span.spanId}`,
      }));

      return success({
        traceId,
        traceDurationMs: Math.round(traceDurationMs * 100) / 100,
        totalSpans: allSpans.length,
        analyzedSpans: formattedSlowSpans.length,
        slowestSpans: formattedSlowSpans,
        byService: Object.fromEntries(
          Object.entries(byService)
            .sort((a, b) => b[1].totalDurationMs - a[1].totalDurationMs)
            .map(([service, data]) => [
              service,
              {
                ...data,
                totalDurationMs: Math.round(data.totalDurationMs * 100) / 100,
                percentOfAnalyzed:
                  Math.round(
                    (data.totalDurationMs / formattedSlowSpans.reduce((sum, s) => sum + s.durationMs, 0)) * 10000,
                  ) / 100,
              },
            ]),
        ),
        byType: Object.fromEntries(
          Object.entries(byType)
            .sort((a, b) => b[1].totalDurationMs - a[1].totalDurationMs)
            .map(([type, data]) => [
              type,
              {
                ...data,
                totalDurationMs: Math.round(data.totalDurationMs * 100) / 100,
              },
            ]),
        ),
        recommendations:
          formattedSlowSpans.length > 0
            ? [
                formattedSlowSpans.some(s => s.type === 'sql')
                  ? 'Consider optimizing database queries - add indexes or reduce query complexity'
                  : null,
                formattedSlowSpans.some(s => s.type === 'http')
                  ? 'Consider caching HTTP responses or optimizing external API calls'
                  : null,
                formattedSlowSpans.some(s => s.percentOfTrace > 50)
                  ? 'Consider parallelizing operations - some spans dominate the trace duration'
                  : null,
              ].filter(Boolean)
            : [],
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      });
    },
  );

  // Get trace critical path
  defineTool(
    tools,
    server,
    'datadog_get_trace_critical_path',
    {
      description: `Get the critical path of a trace - the longest sequential chain of spans.

The critical path shows:
- The sequence of spans that determine the total trace duration
- Which operations cannot be parallelized further
- Where latency improvements would have the biggest impact

This is essential for performance optimization because:
- Reducing time on the critical path directly reduces total latency
- Operations not on the critical path can be slower without affecting overall performance
- It identifies the true bottlenecks vs just slow operations that run in parallel

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format (e.g., "8029474397976343229")'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ traceId, datadogEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: datadogEnv as ServiceEnv | undefined,
      })) as InternalTraceResponse;

      if (!result.trace && !result.orphaned) {
        return success({
          traceId,
          message: 'No trace data found',
        });
      }

      // Collect all spans
      const allSpans: Array<InternalSpan & { spanId: string }> = [];
      if (result.trace) {
        for (const [spanId, span] of Object.entries(result.trace.spans)) {
          allSpans.push({ ...span, spanId });
        }
      }
      if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          for (const [spanId, span] of Object.entries(orphanTree.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
      }

      // Build span lookup and children map
      const spanMap = new Map<string, (typeof allSpans)[0]>();
      const childrenMap = new Map<string, string[]>();

      allSpans.forEach(span => {
        spanMap.set(span.spanId, span);
        if (span.parent_id && span.parent_id !== '0') {
          const siblings = childrenMap.get(span.parent_id) || [];
          siblings.push(span.spanId);
          childrenMap.set(span.parent_id, siblings);
        }
      });

      // Find root spans
      const rootSpans = allSpans.filter(s => !s.parent_id || s.parent_id === '0' || !spanMap.has(s.parent_id));

      if (rootSpans.length === 0) {
        return success({
          traceId,
          message: 'No root span found in trace',
        });
      }

      // Calculate critical path using dynamic programming
      // For each span, find the path that contributes most to its completion time
      const criticalPathCache = new Map<string, { duration: number; path: string[] }>();

      const calculateCriticalPath = (spanId: string): { duration: number; path: string[] } => {
        if (criticalPathCache.has(spanId)) {
          return criticalPathCache.get(spanId)!;
        }

        const span = spanMap.get(spanId);
        if (!span) {
          return { duration: 0, path: [] };
        }

        const children = childrenMap.get(spanId) || [];

        if (children.length === 0) {
          // Leaf span
          const result = { duration: (span.duration || 0) * 1000, path: [spanId] };
          criticalPathCache.set(spanId, result);
          return result;
        }

        // Find child with longest critical path
        let maxChildPath = { duration: 0, path: [] as string[] };
        for (const childId of children) {
          const childPath = calculateCriticalPath(childId);
          if (childPath.duration > maxChildPath.duration) {
            maxChildPath = childPath;
          }
        }

        // Add this span to the critical path
        const result = {
          duration: (span.duration || 0) * 1000,
          path: [spanId, ...maxChildPath.path],
        };

        criticalPathCache.set(spanId, result);
        return result;
      };

      // Calculate critical path from each root and find the longest
      let longestPath = { duration: 0, path: [] as string[] };
      for (const root of rootSpans) {
        const path = calculateCriticalPath(root.spanId);
        if (path.duration > longestPath.duration) {
          longestPath = path;
        }
      }

      // Format the critical path
      const criticalPathSpans = longestPath.path.map(spanId => {
        const span = spanMap.get(spanId)!;
        return {
          spanId,
          service: span.service,
          operation: span.resource || span.name,
          type: span.type,
          durationMs: Math.round((span.duration || 0) * 1000 * 100) / 100,
          hasError: span.error === 1 || span.status === 'error',
          datadogSpanUrl: `https://app.datadoghq.com/apm/trace/${traceId}?spanID=${spanId}`,
        };
      });

      // Calculate what percentage of total time is on critical path
      const totalDuration = Math.max(...allSpans.map(s => (s.end || 0) - (s.start || Infinity))) * 1000;

      // Identify services on critical path
      const servicesOnCriticalPath = [...new Set(criticalPathSpans.map(s => s.service).filter(Boolean))];

      // Identify optimization opportunities
      const optimizationOpportunities: string[] = [];

      // Find the slowest span on critical path
      const slowestOnPath = criticalPathSpans.reduce(
        (max, span) => (span.durationMs > max.durationMs ? span : max),
        criticalPathSpans[0],
      );

      if (slowestOnPath) {
        optimizationOpportunities.push(
          `Focus on optimizing "${slowestOnPath.operation}" in ${slowestOnPath.service} (${slowestOnPath.durationMs}ms)`,
        );
      }

      // Check if there are sequential operations that could be parallelized
      if (criticalPathSpans.length > 3) {
        optimizationOpportunities.push(
          `Consider parallelizing some of the ${criticalPathSpans.length} sequential operations on the critical path`,
        );
      }

      return success({
        traceId,
        criticalPathDurationMs: Math.round(longestPath.duration * 100) / 100,
        totalTraceDurationMs: Math.round(totalDuration * 100) / 100,
        criticalPathSpans: criticalPathSpans.length,
        totalSpans: allSpans.length,
        servicesOnCriticalPath,
        criticalPath: criticalPathSpans,
        optimizationOpportunities,
        insight:
          criticalPathSpans.length > 0
            ? `The critical path has ${criticalPathSpans.length} sequential operations. Optimizing these will directly improve trace latency.`
            : 'Could not determine critical path',
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      });
    },
  );

  // Search for similar traces (same error type, same endpoint, same service)
  defineTool(
    tools,
    server,
    'datadog_search_similar_traces',
    {
      description: `Search for traces with similar characteristics to help identify patterns.

Find traces that share:
- Same error type or status code
- Same service and endpoint
- Same customer or user
- Similar duration (slow traces)

This is useful for:
- Determining if an error is a one-off or systemic issue
- Finding other affected users/customers
- Understanding error frequency and impact
- Identifying when a problem started

Example use cases:
- "Find other traces with DEADLINE_EXCEEDED errors from billing-lifecycle-dgs"
- "Find traces for the same customer that also failed"
- "Find other slow traces (>5s) for this endpoint"

IMPORTANT: Use DECIMAL trace ID format if providing a reference trace.`,
      inputSchema: {
        service: z.string().describe('Service name to search within'),
        env: z.string().optional().default('production').describe('Environment (default: production)'),
        errorType: z.string().optional().describe('Error type to match (e.g., "DEADLINE_EXCEEDED", "NOT_FOUND")'),
        httpStatusCode: z.string().optional().describe('HTTP status code to match (e.g., "504", "500")'),
        resourceName: z.string().optional().describe('Resource/endpoint name to match'),
        customerId: z.string().optional().describe('Customer account ID to filter by'),
        userId: z.string().optional().describe('User ID to filter by'),
        minDurationMs: z.number().optional().describe('Minimum duration in milliseconds (for finding slow traces)'),
        hasError: z.boolean().optional().describe('Only find traces with errors'),
        timeRangeHours: z.number().optional().default(1).describe('Time range in hours (default: 1)'),
        limit: z.number().optional().default(20).describe('Maximum traces to return (default: 20)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({
      service,
      env,
      errorType,
      httpStatusCode,
      resourceName,
      customerId,
      userId,
      minDurationMs,
      hasError,
      timeRangeHours,
      limit,
      datadogEnv,
    }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 1) * 60 * 60 * 1000;

      // Build query parts
      const queryParts: string[] = [`service:${service}`];
      if (env) queryParts.push(`env:${env}`);
      if (errorType) queryParts.push(`@error.type:*${errorType}*`);
      if (httpStatusCode) queryParts.push(`@http.status_code:${httpStatusCode}`);
      if (resourceName) queryParts.push(`resource_name:"${resourceName}"`);
      if (customerId) queryParts.push(`@identity.customer_identity_context.customer_account_id:${customerId}`);
      if (userId) queryParts.push(`@identity.customer_identity_context.customer_user_id:${userId}`);
      if (minDurationMs) queryParts.push(`@duration:>=${minDurationMs * 1000000}`); // Convert ms to ns
      if (hasError) queryParts.push('status:error');

      const query = queryParts.join(' ');

      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query,
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
          trace_id?: string;
          span_id?: string;
          timestamp?: string;
          service?: string;
          resource_name?: string;
          status?: string;
          custom?: {
            duration?: number;
            http?: {
              status_code?: string;
            };
            error?: {
              type?: string;
              message?: string;
            };
            [key: string]: unknown;
          };
        };
      }

      const response = result as { data?: SpanEvent[] };
      const spans = response.data || [];

      // Group by trace ID to get unique traces
      const traceMap = new Map<
        string,
        {
          traceId: string;
          timestamp: string;
          resource: string;
          status: string;
          httpStatusCode?: string;
          errorType?: string;
          errorMessage?: string;
          durationMs?: number;
        }
      >();

      for (const span of spans) {
        const traceId = span.attributes?.trace_id;
        if (traceId && !traceMap.has(traceId)) {
          const custom = span.attributes?.custom || {};
          traceMap.set(traceId, {
            traceId,
            timestamp: span.attributes?.timestamp || '',
            resource: span.attributes?.resource_name || '',
            status: span.attributes?.status || '',
            httpStatusCode: custom.http?.status_code,
            errorType: custom.error?.type,
            errorMessage: custom.error?.message,
            durationMs: typeof custom.duration === 'number' ? custom.duration / 1000000 : undefined,
          });
        }
      }

      const traces = Array.from(traceMap.values()).map(t => ({
        ...t,
        datadogUrl: `https://app.datadoghq.com/apm/trace/${t.traceId}`,
      }));

      return success({
        query,
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        totalTraces: traces.length,
        traces,
        insight:
          traces.length > 0
            ? `Found ${traces.length} similar traces. ${traces.filter(t => t.status === 'error').length} with errors.`
            : 'No similar traces found in the time range.',
      });
    },
  );

  // Get traces for a specific customer
  defineTool(
    tools,
    server,
    'datadog_get_customer_traces',
    {
      description: `Find all traces for a specific customer account or user.

This is essential for:
- Investigating issues reported by a specific customer
- Understanding a customer's experience over time
- Finding all errors affecting a particular account
- Debugging issues isolated to specific customers

The tool searches for traces tagged with customer identity information, which is
typically set via:
- identity.customer_identity_context.customer_account_id
- identity.customer_identity_context.customer_user_id
- usr.companyId / usr.customerAccountId
- usr.id / usr.customerUserId

IMPORTANT: Customer IDs are typically prefixed (e.g., "cuacc_xxx" for customer accounts).`,
      inputSchema: {
        customerId: z.string().optional().describe('Customer account ID (e.g., "cuacc_xxx")'),
        userId: z.string().optional().describe('User ID within the customer account'),
        service: z.string().optional().describe('Filter to a specific service'),
        env: z.string().optional().default('production').describe('Environment (default: production)'),
        hasError: z.boolean().optional().describe('Only show traces with errors'),
        timeRangeHours: z.number().optional().default(1).describe('Time range in hours (default: 1)'),
        limit: z.number().optional().default(50).describe('Maximum traces to return (default: 50)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ customerId, userId, service, env, hasError, timeRangeHours, limit, datadogEnv }) => {
      if (!customerId && !userId) {
        return success({
          error: 'Either customerId or userId must be provided',
          hint: 'Use customerId for account-level queries, userId for user-level queries',
        });
      }

      const now = Date.now();
      const from = now - (timeRangeHours ?? 1) * 60 * 60 * 1000;

      // Build query - try multiple tag variations that might contain customer ID
      const queryParts: string[] = [];

      if (customerId) {
        // Search across multiple possible tag names
        queryParts.push(
          `(@identity.customer_identity_context.customer_account_id:${customerId} OR @usr.companyId:${customerId} OR @usr.customerAccountId:${customerId})`,
        );
      }

      if (userId) {
        queryParts.push(
          `(@identity.customer_identity_context.customer_user_id:${userId} OR @usr.id:${userId} OR @usr.customerUserId:${userId})`,
        );
      }

      if (service) queryParts.push(`service:${service}`);
      if (env) queryParts.push(`env:${env}`);
      if (hasError) queryParts.push('status:error');

      const query = queryParts.join(' ');

      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: Math.min((limit ?? 50) * 2, 200), // Get more spans to find unique traces
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
          trace_id?: string;
          timestamp?: string;
          service?: string;
          resource_name?: string;
          status?: string;
          custom?: {
            duration?: number;
            http?: {
              status_code?: string;
            };
            error?: {
              message?: string;
            };
            [key: string]: unknown;
          };
        };
      }

      const response = result as { data?: SpanEvent[] };
      const spans = response.data || [];

      // Group by trace ID
      const traceMap = new Map<
        string,
        {
          traceId: string;
          timestamp: string;
          service: string;
          resource: string;
          status: string;
          httpStatusCode?: string;
          errorMessage?: string;
          durationMs?: number;
        }
      >();

      for (const span of spans) {
        const traceId = span.attributes?.trace_id;
        if (traceId && !traceMap.has(traceId)) {
          const custom = span.attributes?.custom || {};
          traceMap.set(traceId, {
            traceId,
            timestamp: span.attributes?.timestamp || '',
            service: span.attributes?.service || '',
            resource: span.attributes?.resource_name || '',
            status: span.attributes?.status || '',
            httpStatusCode: custom.http?.status_code,
            errorMessage: custom.error?.message,
            durationMs: typeof custom.duration === 'number' ? custom.duration / 1000000 : undefined,
          });
        }
      }

      // Sort by timestamp descending and limit
      const traces = Array.from(traceMap.values())
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit ?? 50)
        .map(t => ({
          ...t,
          datadogUrl: `https://app.datadoghq.com/apm/trace/${t.traceId}`,
        }));

      // Calculate summary stats
      const errorCount = traces.filter(t => t.status === 'error').length;
      const serviceBreakdown: Record<string, number> = {};
      for (const trace of traces) {
        serviceBreakdown[trace.service] = (serviceBreakdown[trace.service] || 0) + 1;
      }

      return success({
        customerId,
        userId,
        query,
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        summary: {
          totalTraces: traces.length,
          errorCount,
          errorRate: traces.length > 0 ? Math.round((errorCount / traces.length) * 10000) / 100 : 0,
          serviceBreakdown,
        },
        traces,
        insight:
          traces.length > 0
            ? `Found ${traces.length} traces for this customer. ${errorCount} (${Math.round((errorCount / traces.length) * 100)}%) had errors.`
            : 'No traces found for this customer in the time range. Try expanding the time range or checking the customer ID format.',
      });
    },
  );

  // Analyze database queries in a trace
  defineTool(
    tools,
    server,
    'datadog_get_database_query_analysis',
    {
      description: `Analyze database queries in a trace to identify performance issues.

This tool examines all database spans and identifies:
- **Slow queries**: Queries taking longer than expected
- **N+1 patterns**: Similar queries executed many times (potential N+1 problem)
- **Query statistics**: Count, total time, and average time per query type
- **Optimization suggestions**: Actionable recommendations

Use this when:
- A trace is slow and you suspect database issues
- You want to find N+1 query patterns
- You need to identify which queries to optimize

IMPORTANT: Use the DECIMAL trace ID format (e.g., "8029474397976343229"), not hex.`,
      inputSchema: {
        traceId: z.string().describe('The trace ID in decimal format'),
        slowQueryThresholdMs: z
          .number()
          .optional()
          .default(100)
          .describe('Threshold in ms for "slow" queries (default: 100)'),
        n1Threshold: z
          .number()
          .optional()
          .default(5)
          .describe('Minimum similar queries to flag as potential N+1 (default: 5)'),
        serviceEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ traceId, slowQueryThresholdMs, n1Threshold, serviceEnv }) => {
      const result = (await sendServiceRequest('datadog', {
        endpoint: `/api/v1/trace/${traceId}`,
        method: 'GET',
        env: serviceEnv,
      })) as InternalTraceResponse;

      if (!result.trace && !result.orphaned) {
        return success({
          traceId,
          message: 'No trace data found',
        });
      }

      // Collect all spans
      const allSpans: Array<InternalSpan & { spanId: string }> = [];
      if (result.trace) {
        for (const [spanId, span] of Object.entries(result.trace.spans)) {
          allSpans.push({ ...span, spanId });
        }
      }
      if (result.orphaned) {
        for (const orphanTree of result.orphaned) {
          for (const [spanId, span] of Object.entries(orphanTree.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
      }

      // Filter to database spans
      const dbSpans = allSpans.filter(
        s =>
          s.type === 'sql' ||
          s.type === 'cassandra' ||
          s.type === 'mongodb' ||
          s.type === 'redis' ||
          s.type === 'elasticsearch' ||
          s.meta?.['db.system'] ||
          s.meta?.['db.statement'] ||
          s.meta?.['sql.query'],
      );

      if (dbSpans.length === 0) {
        return success({
          traceId,
          message: 'No database queries found in this trace',
          hint: 'This trace may not involve database operations, or DB spans may not be instrumented.',
          datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
        });
      }

      // Analyze queries
      const slowThreshold = (slowQueryThresholdMs ?? 100) / 1000; // Convert to seconds
      const n1ThresholdCount = n1Threshold ?? 5;

      const slowQueries: Array<{
        spanId: string;
        query: string;
        durationMs: number;
        dbSystem?: string;
        service: string;
      }> = [];

      // Group queries by normalized pattern for N+1 detection
      const queryPatterns = new Map<
        string,
        {
          pattern: string;
          count: number;
          totalDurationMs: number;
          spanIds: string[];
          service: string;
          dbSystem?: string;
        }
      >();

      // Stats
      let totalDbTimeMs = 0;
      const dbSystemStats: Record<string, { count: number; totalMs: number }> = {};

      for (const span of dbSpans) {
        const durationMs = (span.duration || 0) * 1000;
        totalDbTimeMs += durationMs;

        const query = span.meta?.['db.statement'] || span.meta?.['sql.query'] || span.resource || '';
        const dbSystem = span.meta?.['db.system'] || span.type || 'unknown';
        const service = span.service || 'unknown';

        // Track by DB system
        if (!dbSystemStats[dbSystem]) {
          dbSystemStats[dbSystem] = { count: 0, totalMs: 0 };
        }
        dbSystemStats[dbSystem].count++;
        dbSystemStats[dbSystem].totalMs += durationMs;

        // Check for slow queries
        if ((span.duration || 0) > slowThreshold) {
          slowQueries.push({
            spanId: span.spanId,
            query: query.substring(0, 500), // Truncate long queries
            durationMs: Math.round(durationMs * 100) / 100,
            dbSystem,
            service,
          });
        }

        // Normalize query pattern for N+1 detection
        // Replace specific values with placeholders
        const normalizedPattern = query
          .replace(/\b\d+\b/g, '?') // Replace numbers
          .replace(/'[^']*'/g, '?') // Replace string literals
          .replace(/"[^"]*"/g, '?') // Replace double-quoted strings
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim()
          .substring(0, 200); // Truncate for grouping

        const key = `${service}:${dbSystem}:${normalizedPattern}`;
        const existing = queryPatterns.get(key);
        if (existing) {
          existing.count++;
          existing.totalDurationMs += durationMs;
          existing.spanIds.push(span.spanId);
        } else {
          queryPatterns.set(key, {
            pattern: normalizedPattern,
            count: 1,
            totalDurationMs: durationMs,
            spanIds: [span.spanId],
            service,
            dbSystem,
          });
        }
      }

      // Find N+1 patterns
      const n1Patterns = Array.from(queryPatterns.values())
        .filter(p => p.count >= n1ThresholdCount)
        .sort((a, b) => b.count - a.count)
        .map(p => ({
          pattern: p.pattern,
          count: p.count,
          totalDurationMs: Math.round(p.totalDurationMs * 100) / 100,
          avgDurationMs: Math.round((p.totalDurationMs / p.count) * 100) / 100,
          service: p.service,
          dbSystem: p.dbSystem,
          severity: p.count >= 50 ? 'critical' : p.count >= 20 ? 'high' : p.count >= 10 ? 'medium' : 'low',
          suggestion: `Consider batching these ${p.count} queries into a single query or using eager loading`,
        }));

      // Calculate trace duration for percentage
      const traceStart = Math.min(...allSpans.map(s => s.start || Infinity));
      const traceEnd = Math.max(...allSpans.map(s => s.end || 0));
      const traceDurationMs = (traceEnd - traceStart) * 1000;

      // Generate recommendations
      const recommendations: string[] = [];

      if (n1Patterns.length > 0) {
        const worstN1 = n1Patterns[0];
        recommendations.push(
          `🔴 Critical: Found ${n1Patterns.length} potential N+1 query patterns. Worst offender: "${worstN1.pattern.substring(0, 50)}..." executed ${worstN1.count} times.`,
        );
      }

      if (slowQueries.length > 0) {
        recommendations.push(
          `⚠️ Found ${slowQueries.length} slow queries (>${slowQueryThresholdMs}ms). Consider adding indexes or optimizing query plans.`,
        );
      }

      const dbTimePercent = traceDurationMs > 0 ? (totalDbTimeMs / traceDurationMs) * 100 : 0;
      if (dbTimePercent > 50) {
        recommendations.push(
          `📊 Database operations account for ${Math.round(dbTimePercent)}% of trace time. Focus DB optimization for best results.`,
        );
      }

      return success({
        traceId,
        summary: {
          totalDbQueries: dbSpans.length,
          totalDbTimeMs: Math.round(totalDbTimeMs * 100) / 100,
          dbTimePercent: Math.round(dbTimePercent * 100) / 100,
          slowQueryCount: slowQueries.length,
          n1PatternCount: n1Patterns.length,
        },
        dbSystemStats: Object.fromEntries(
          Object.entries(dbSystemStats).map(([sys, stats]) => [
            sys,
            {
              count: stats.count,
              totalMs: Math.round(stats.totalMs * 100) / 100,
              avgMs: Math.round((stats.totalMs / stats.count) * 100) / 100,
            },
          ]),
        ),
        n1Patterns: n1Patterns.length > 0 ? n1Patterns : undefined,
        slowQueries:
          slowQueries.length > 0
            ? slowQueries.sort((a, b) => b.durationMs - a.durationMs).slice(0, 10) // Top 10 slowest
            : undefined,
        recommendations,
        datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
      });
    },
  );

  // Compare two traces side by side
  defineTool(
    tools,
    server,
    'datadog_compare_traces',
    {
      description: `Compare two traces side-by-side to understand performance differences.

This is essential for debugging performance regressions by comparing:
- A slow/failing trace vs a fast/successful trace
- A trace before a deployment vs after
- A trace from different customers experiencing different behaviors

The comparison shows:
- Duration differences (total and by service)
- Service call differences (what's present in one but not the other)
- Error differences
- Database query count differences
- Critical path comparison

Use this when:
- You have a slow trace and want to compare it to a normal one
- You're investigating why one request failed but a similar one succeeded
- You want to understand what changed between two similar requests

IMPORTANT: Use DECIMAL trace ID format for both traces.`,
      inputSchema: {
        traceId1: z.string().describe('First trace ID (e.g., the "slow" or "bad" trace)'),
        traceId2: z.string().describe('Second trace ID (e.g., the "fast" or "good" trace)'),
        label1: z.string().optional().default('Trace 1').describe('Label for first trace (default: "Trace 1")'),
        label2: z.string().optional().default('Trace 2').describe('Label for second trace (default: "Trace 2")'),
        serviceEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ traceId1, traceId2, label1, label2, serviceEnv }) => {
      // Fetch both traces in parallel
      const [result1, result2] = await Promise.all([
        sendServiceRequest('datadog', {
          endpoint: `/api/v1/trace/${traceId1}`,
          method: 'GET',
          env: serviceEnv,
        }) as Promise<InternalTraceResponse>,
        sendServiceRequest('datadog', {
          endpoint: `/api/v1/trace/${traceId2}`,
          method: 'GET',
          env: serviceEnv,
        }) as Promise<InternalTraceResponse>,
      ]);

      // Helper to analyze a trace
      const analyzeTrace = (result: InternalTraceResponse, traceId: string) => {
        const allSpans: Array<InternalSpan & { spanId: string }> = [];
        if (result.trace) {
          for (const [spanId, span] of Object.entries(result.trace.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
        if (result.orphaned) {
          for (const orphanTree of result.orphaned) {
            for (const [spanId, span] of Object.entries(orphanTree.spans)) {
              allSpans.push({ ...span, spanId });
            }
          }
        }

        if (allSpans.length === 0) {
          return null;
        }

        const traceStart = Math.min(...allSpans.map(s => s.start || Infinity));
        const traceEnd = Math.max(...allSpans.map(s => s.end || 0));
        const totalDurationMs = (traceEnd - traceStart) * 1000;

        // Service breakdown
        const serviceStats: Record<string, { count: number; totalMs: number; errorCount: number }> = {};
        let totalErrors = 0;
        let dbQueries = 0;

        for (const span of allSpans) {
          const service = span.service || 'unknown';
          const durationMs = (span.duration || 0) * 1000;
          const hasError = span.error === 1 || span.status === 'error';

          if (!serviceStats[service]) {
            serviceStats[service] = { count: 0, totalMs: 0, errorCount: 0 };
          }
          serviceStats[service].count++;
          serviceStats[service].totalMs += durationMs;
          if (hasError) {
            serviceStats[service].errorCount++;
            totalErrors++;
          }

          if (span.type === 'sql' || span.meta?.['db.system']) {
            dbQueries++;
          }
        }

        // Get unique services and resources
        const services = new Set<string>();
        const resources = new Set<string>();
        for (const span of allSpans) {
          if (span.service) services.add(span.service);
          if (span.resource) resources.add(`${span.service}:${span.resource}`);
        }

        return {
          traceId,
          totalSpans: allSpans.length,
          totalDurationMs: Math.round(totalDurationMs * 100) / 100,
          totalErrors,
          dbQueries,
          services: Array.from(services),
          resourceCount: resources.size,
          resources: Array.from(resources),
          serviceStats: Object.fromEntries(
            Object.entries(serviceStats).map(([svc, stats]) => [
              svc,
              {
                count: stats.count,
                totalMs: Math.round(stats.totalMs * 100) / 100,
                errorCount: stats.errorCount,
              },
            ]),
          ),
        };
      };

      const analysis1 = analyzeTrace(result1, traceId1);
      const analysis2 = analyzeTrace(result2, traceId2);

      if (!analysis1 || !analysis2) {
        return success({
          error: 'One or both traces not found',
          trace1Found: !!analysis1,
          trace2Found: !!analysis2,
        });
      }

      // Calculate differences
      const durationDiff = analysis1.totalDurationMs - analysis2.totalDurationMs;
      const durationDiffPercent = analysis2.totalDurationMs > 0 ? (durationDiff / analysis2.totalDurationMs) * 100 : 0;

      // Find services unique to each trace
      const services1 = new Set(analysis1.services);
      const services2 = new Set(analysis2.services);
      const onlyInTrace1 = analysis1.services.filter(s => !services2.has(s));
      const onlyInTrace2 = analysis2.services.filter(s => !services1.has(s));

      // Find service timing differences
      const serviceDiffs: Array<{
        service: string;
        trace1Ms: number;
        trace2Ms: number;
        diffMs: number;
        diffPercent: number;
      }> = [];

      const allServices = new Set([...analysis1.services, ...analysis2.services]);
      for (const service of allServices) {
        const stats1 = analysis1.serviceStats[service];
        const stats2 = analysis2.serviceStats[service];
        if (stats1 && stats2) {
          const diff = stats1.totalMs - stats2.totalMs;
          if (Math.abs(diff) > 10) {
            // Only show significant differences
            serviceDiffs.push({
              service,
              trace1Ms: stats1.totalMs,
              trace2Ms: stats2.totalMs,
              diffMs: Math.round(diff * 100) / 100,
              diffPercent: stats2.totalMs > 0 ? Math.round((diff / stats2.totalMs) * 10000) / 100 : 0,
            });
          }
        }
      }

      // Sort by absolute difference
      serviceDiffs.sort((a, b) => Math.abs(b.diffMs) - Math.abs(a.diffMs));

      // Generate insights
      const insights: string[] = [];

      if (Math.abs(durationDiffPercent) > 50) {
        insights.push(
          `${label1 ?? 'Trace 1'} is ${durationDiff > 0 ? 'slower' : 'faster'} by ${Math.abs(Math.round(durationDiff))}ms (${Math.abs(Math.round(durationDiffPercent))}%)`,
        );
      }

      if (onlyInTrace1.length > 0) {
        insights.push(`Services only in ${label1 ?? 'Trace 1'}: ${onlyInTrace1.join(', ')}`);
      }
      if (onlyInTrace2.length > 0) {
        insights.push(`Services only in ${label2 ?? 'Trace 2'}: ${onlyInTrace2.join(', ')}`);
      }

      if (serviceDiffs.length > 0) {
        const biggest = serviceDiffs[0];
        insights.push(
          `Biggest timing difference in ${biggest.service}: ${biggest.diffMs > 0 ? '+' : ''}${biggest.diffMs}ms`,
        );
      }

      if (analysis1.dbQueries !== analysis2.dbQueries) {
        insights.push(
          `DB query count differs: ${label1 ?? 'Trace 1'} has ${analysis1.dbQueries}, ${label2 ?? 'Trace 2'} has ${analysis2.dbQueries}`,
        );
      }

      return success({
        comparison: {
          [label1 ?? 'trace1']: {
            traceId: traceId1,
            totalDurationMs: analysis1.totalDurationMs,
            totalSpans: analysis1.totalSpans,
            totalErrors: analysis1.totalErrors,
            dbQueries: analysis1.dbQueries,
            serviceCount: analysis1.services.length,
            datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId1}`,
          },
          [label2 ?? 'trace2']: {
            traceId: traceId2,
            totalDurationMs: analysis2.totalDurationMs,
            totalSpans: analysis2.totalSpans,
            totalErrors: analysis2.totalErrors,
            dbQueries: analysis2.dbQueries,
            serviceCount: analysis2.services.length,
            datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId2}`,
          },
        },
        differences: {
          durationDiffMs: Math.round(durationDiff * 100) / 100,
          durationDiffPercent: Math.round(durationDiffPercent * 100) / 100,
          spanCountDiff: analysis1.totalSpans - analysis2.totalSpans,
          errorCountDiff: analysis1.totalErrors - analysis2.totalErrors,
          dbQueryDiff: analysis1.dbQueries - analysis2.dbQueries,
          servicesOnlyInTrace1: onlyInTrace1.length > 0 ? onlyInTrace1 : undefined,
          servicesOnlyInTrace2: onlyInTrace2.length > 0 ? onlyInTrace2 : undefined,
          serviceTiming: serviceDiffs.length > 0 ? serviceDiffs.slice(0, 10) : undefined,
        },
        insights,
      });
    },
  );

  // Batch compare multiple traces
  defineTool(
    tools,
    server,
    'datadog_batch_compare_traces',
    {
      description: `Analyze and compare multiple traces at once to identify patterns.

This is useful for:
- Comparing several slow traces to find common bottlenecks
- Analyzing a batch of error traces to identify patterns
- Understanding variability across similar requests
- Finding outliers in a set of traces

The tool provides:
- Summary statistics across all traces (min/max/avg duration, error rate)
- Service breakdown showing which services appear across traces
- Common patterns (services/operations present in most traces)
- Outlier detection (traces significantly different from others)

Use this when you have multiple trace IDs from search results or similar requests.

IMPORTANT: Use DECIMAL trace ID format for all traces.`,
      inputSchema: {
        traceIds: z
          .array(z.string())
          .min(2)
          .max(10)
          .describe('Array of trace IDs to compare (2-10 traces, decimal format)'),
        focusService: z
          .string()
          .optional()
          .describe('Service to focus comparison on (optional - shows detailed breakdown for this service)'),
        serviceEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ traceIds, focusService, serviceEnv }) => {
      // Fetch all traces in parallel
      const tracePromises = traceIds.map(traceId =>
        sendServiceRequest('datadog', { endpoint: `/api/v1/trace/${traceId}`, method: 'GET', env: serviceEnv })
          .then(result => ({ traceId, result: result as InternalTraceResponse, error: null }))
          .catch(err => ({ traceId, result: null, error: err })),
      );

      const traceResults = await Promise.all(tracePromises);

      // Analyze each trace
      interface TraceAnalysis {
        traceId: string;
        totalDurationMs: number;
        spanCount: number;
        errorCount: number;
        services: string[];
        serviceTimings: Record<string, number>;
        hasError: boolean;
        focusServiceDurationMs?: number;
        datadogUrl: string;
      }

      const analyses: TraceAnalysis[] = [];
      const failedTraces: Array<{ traceId: string; error: string }> = [];

      for (const { traceId, result, error: fetchError } of traceResults) {
        if (fetchError || !result) {
          failedTraces.push({
            traceId,
            error: fetchError instanceof Error ? fetchError.message : 'Failed to fetch trace',
          });
          continue;
        }

        // Collect all spans
        const allSpans: Array<InternalSpan & { spanId: string }> = [];
        if (result.trace) {
          for (const [spanId, span] of Object.entries(result.trace.spans)) {
            allSpans.push({ ...span, spanId });
          }
        }
        if (result.orphaned) {
          for (const orphanTree of result.orphaned) {
            for (const [spanId, span] of Object.entries(orphanTree.spans)) {
              allSpans.push({ ...span, spanId });
            }
          }
        }

        if (allSpans.length === 0) {
          failedTraces.push({ traceId, error: 'No spans found in trace' });
          continue;
        }

        // Calculate trace metrics
        const traceStart = Math.min(...allSpans.map(s => s.start || Infinity));
        const traceEnd = Math.max(...allSpans.map(s => s.end || 0));
        const totalDurationMs = (traceEnd - traceStart) * 1000;

        const services = new Set<string>();
        const serviceTimings: Record<string, number> = {};
        let errorCount = 0;
        let focusServiceDuration = 0;

        for (const span of allSpans) {
          const service = span.service || 'unknown';
          services.add(service);

          const durationMs = (span.duration || 0) * 1000;
          serviceTimings[service] = (serviceTimings[service] || 0) + durationMs;

          if (span.error === 1 || span.status === 'error') {
            errorCount++;
          }

          if (focusService && service === focusService) {
            focusServiceDuration += durationMs;
          }
        }

        analyses.push({
          traceId,
          totalDurationMs: Math.round(totalDurationMs * 100) / 100,
          spanCount: allSpans.length,
          errorCount,
          services: Array.from(services),
          serviceTimings: Object.fromEntries(
            Object.entries(serviceTimings).map(([s, t]) => [s, Math.round(t * 100) / 100]),
          ),
          hasError: errorCount > 0,
          focusServiceDurationMs: focusService ? Math.round(focusServiceDuration * 100) / 100 : undefined,
          datadogUrl: `https://app.datadoghq.com/apm/trace/${traceId}`,
        });
      }

      if (analyses.length === 0) {
        return success({
          error: 'No valid traces could be analyzed',
          failedTraces,
        });
      }

      // Calculate aggregate statistics
      const durations = analyses.map(a => a.totalDurationMs);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      const stdDev = Math.sqrt(durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length);

      // Find common and unique services
      const serviceAppearances: Record<string, number> = {};
      for (const analysis of analyses) {
        for (const service of analysis.services) {
          serviceAppearances[service] = (serviceAppearances[service] || 0) + 1;
        }
      }

      const commonServices = Object.entries(serviceAppearances)
        .filter(([, count]) => count === analyses.length)
        .map(([service]) => service);

      const rareServices = Object.entries(serviceAppearances)
        .filter(([, count]) => count === 1)
        .map(([service]) => service);

      // Identify outliers (traces > 2 std devs from mean)
      const outlierThreshold = avgDuration + 2 * stdDev;
      const outliers = analyses.filter(a => a.totalDurationMs > outlierThreshold);

      // Calculate service-level statistics
      const serviceStats: Record<
        string,
        {
          appearanceCount: number;
          avgDurationMs: number;
          minDurationMs: number;
          maxDurationMs: number;
        }
      > = {};

      for (const [service, count] of Object.entries(serviceAppearances)) {
        const timings = analyses
          .filter(a => a.serviceTimings[service] !== undefined)
          .map(a => a.serviceTimings[service]);

        if (timings.length > 0) {
          serviceStats[service] = {
            appearanceCount: count,
            avgDurationMs: Math.round((timings.reduce((a, b) => a + b, 0) / timings.length) * 100) / 100,
            minDurationMs: Math.round(Math.min(...timings) * 100) / 100,
            maxDurationMs: Math.round(Math.max(...timings) * 100) / 100,
          };
        }
      }

      // Focus service analysis if specified
      let focusServiceAnalysis:
        | {
            service: string;
            presentInTraces: number;
            avgDurationMs: number;
            minDurationMs: number;
            maxDurationMs: number;
            variabilityPercent: number;
            durationsByTrace: Array<{ traceId: string; durationMs: number }>;
          }
        | undefined;

      if (focusService) {
        const focusTimings = analyses
          .filter(a => a.focusServiceDurationMs !== undefined)
          .map(a => ({ traceId: a.traceId, durationMs: a.focusServiceDurationMs! }));

        if (focusTimings.length > 0) {
          const focusDurations = focusTimings.map(f => f.durationMs);
          const focusAvg = focusDurations.reduce((a, b) => a + b, 0) / focusDurations.length;
          const focusStdDev = Math.sqrt(
            focusDurations.reduce((sum, d) => sum + Math.pow(d - focusAvg, 2), 0) / focusDurations.length,
          );

          focusServiceAnalysis = {
            service: focusService,
            presentInTraces: focusTimings.length,
            avgDurationMs: Math.round(focusAvg * 100) / 100,
            minDurationMs: Math.round(Math.min(...focusDurations) * 100) / 100,
            maxDurationMs: Math.round(Math.max(...focusDurations) * 100) / 100,
            variabilityPercent: focusAvg > 0 ? Math.round((focusStdDev / focusAvg) * 10000) / 100 : 0,
            durationsByTrace: focusTimings.sort((a, b) => b.durationMs - a.durationMs),
          };
        }
      }

      // Generate insights
      const insights: string[] = [];

      if (stdDev / avgDuration > 0.5) {
        insights.push(`High variability: Duration varies significantly (std dev = ${Math.round(stdDev)}ms)`);
      }

      if (outliers.length > 0) {
        insights.push(
          `Found ${outliers.length} outlier(s) with duration > ${Math.round(outlierThreshold)}ms: ${outliers.map(o => o.traceId).join(', ')}`,
        );
      }

      if (rareServices.length > 0) {
        insights.push(`Services appearing in only one trace: ${rareServices.join(', ')}`);
      }

      const errorTraces = analyses.filter(a => a.hasError);
      if (errorTraces.length > 0) {
        insights.push(`${errorTraces.length} of ${analyses.length} traces have errors`);
      }

      // Find service with highest variability
      const serviceVariabilities = Object.entries(serviceStats)
        .filter(([, stats]) => stats.appearanceCount >= 2)
        .map(([service, stats]) => ({
          service,
          variability: stats.avgDurationMs > 0 ? (stats.maxDurationMs - stats.minDurationMs) / stats.avgDurationMs : 0,
        }))
        .sort((a, b) => b.variability - a.variability);

      if (serviceVariabilities.length > 0 && serviceVariabilities[0].variability > 1) {
        insights.push(
          `Highest timing variability in ${serviceVariabilities[0].service} (${Math.round(serviceVariabilities[0].variability * 100)}% range)`,
        );
      }

      return success({
        summary: {
          tracesAnalyzed: analyses.length,
          tracesFailed: failedTraces.length,
          errorTraceCount: errorTraces.length,
          duration: {
            avgMs: Math.round(avgDuration * 100) / 100,
            minMs: Math.round(minDuration * 100) / 100,
            maxMs: Math.round(maxDuration * 100) / 100,
            stdDevMs: Math.round(stdDev * 100) / 100,
          },
          serviceCount: Object.keys(serviceAppearances).length,
          commonServices,
        },
        traces: analyses.map(a => ({
          traceId: a.traceId,
          durationMs: a.totalDurationMs,
          spanCount: a.spanCount,
          errorCount: a.errorCount,
          hasError: a.hasError,
          focusServiceDurationMs: a.focusServiceDurationMs,
          datadogUrl: a.datadogUrl,
        })),
        serviceStats,
        focusServiceAnalysis,
        outliers:
          outliers.length > 0
            ? outliers.map(o => ({
                traceId: o.traceId,
                durationMs: o.totalDurationMs,
                datadogUrl: o.datadogUrl,
              }))
            : undefined,
        insights,
        failedTraces: failedTraces.length > 0 ? failedTraces : undefined,
      });
    },
  );

  // Get gRPC method statistics
  defineTool(
    tools,
    server,
    'datadog_get_grpc_method_stats',
    {
      description: `Get performance statistics (p50, p95, p99, error rate) for gRPC methods.

This helps you understand:
- Normal latency ranges for a gRPC method
- Whether a slow call is an outlier or normal
- Error rates for specific methods
- Performance trends over time

Use this when:
- You see a slow gRPC call and want to know if it's typical
- You want to identify which gRPC methods have high error rates
- You need baseline performance data for a service

Example: If you see a 60s gRPC call, use this to check if that method's p99 is normally <1s.`,
      inputSchema: {
        service: z.string().describe('Service name that exposes the gRPC method'),
        method: z
          .string()
          .optional()
          .describe('Specific gRPC method name (e.g., "CalculateCurrentBalances"). If omitted, shows all methods.'),
        env: z.string().optional().default('production').describe('Environment (default: production)'),
        timeRangeHours: z.number().optional().default(1).describe('Time range in hours (default: 1)'),
        serviceEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ service, method, env, timeRangeHours, serviceEnv }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 1) * 60 * 60 * 1000;

      // Build query for gRPC spans
      const queryParts = [`service:${service}`, `env:${env ?? 'production'}`];
      if (method) {
        queryParts.push(`@rpc.method:*${method}*`);
      } else {
        // Require gRPC-related tags to filter to gRPC calls
        queryParts.push('(@rpc.method:* OR @grpc.method:*)');
      }

      const query = queryParts.join(' ');

      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: 1000, // Get many samples for statistics
            },
          },
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/spans/events/search',
        method: 'POST',
        body: requestBody,
        env: serviceEnv,
      });

      interface SpanEvent {
        attributes?: {
          timestamp?: string;
          resource_name?: string;
          status?: string;
          custom?: {
            duration?: number;
            rpc?: {
              method?: string;
              grpc?: {
                status_code?: number;
              };
            };
            grpc?: {
              method?: string;
              status?: {
                code?: number;
              };
            };
            [key: string]: unknown;
          };
        };
      }

      const response = result as { data?: SpanEvent[] };
      const spans = response.data || [];

      if (spans.length === 0) {
        return success({
          service,
          method,
          message: 'No gRPC spans found for this service/method',
          hint: 'Verify the service name and ensure gRPC instrumentation is enabled.',
          query,
        });
      }

      // Group by method
      const methodStats = new Map<
        string,
        {
          durations: number[];
          errorCount: number;
          totalCount: number;
          statusCodes: Record<string, number>;
        }
      >();

      for (const span of spans) {
        const custom = span.attributes?.custom || {};
        // Duration is in custom.duration (nanoseconds)
        const durationNs = custom.duration;
        // Method name is in custom.rpc.method or resource_name
        const methodName = custom.rpc?.method || custom.grpc?.method || span.attributes?.resource_name || 'unknown';
        // Status code is in custom.rpc.grpc.status_code
        const statusCode = custom.rpc?.grpc?.status_code ?? custom.grpc?.status?.code;
        const status = span.attributes?.status;

        const existing = methodStats.get(methodName) || {
          durations: [],
          errorCount: 0,
          totalCount: 0,
          statusCodes: {},
        };

        existing.totalCount++;
        if (typeof durationNs === 'number') {
          existing.durations.push(durationNs / 1000000); // Convert to ms
        }
        if (status === 'error') {
          existing.errorCount++;
        }
        if (statusCode) {
          existing.statusCodes[statusCode] = (existing.statusCodes[statusCode] || 0) + 1;
        }

        methodStats.set(methodName, existing);
      }

      // Calculate percentiles for each method
      const calculatePercentile = (arr: number[], p: number): number => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
      };

      const methods = Array.from(methodStats.entries()).map(([methodName, stats]) => {
        const p50 = calculatePercentile(stats.durations, 50);
        const p95 = calculatePercentile(stats.durations, 95);
        const p99 = calculatePercentile(stats.durations, 99);
        const min = Math.min(...stats.durations);
        const max = Math.max(...stats.durations);
        const avg =
          stats.durations.length > 0 ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length : 0;

        return {
          method: methodName,
          sampleCount: stats.totalCount,
          errorCount: stats.errorCount,
          errorRate: Math.round((stats.errorCount / stats.totalCount) * 10000) / 100,
          latency: {
            p50Ms: Math.round(p50 * 100) / 100,
            p95Ms: Math.round(p95 * 100) / 100,
            p99Ms: Math.round(p99 * 100) / 100,
            avgMs: Math.round(avg * 100) / 100,
            minMs: Math.round(min * 100) / 100,
            maxMs: Math.round(max * 100) / 100,
          },
          statusCodes: Object.keys(stats.statusCodes).length > 0 ? stats.statusCodes : undefined,
        };
      });

      // Sort by request count
      methods.sort((a, b) => b.sampleCount - a.sampleCount);

      // Find methods with high error rates or latency
      const alerts: string[] = [];
      for (const m of methods) {
        if (m.errorRate > 5) {
          alerts.push(`⚠️ ${m.method} has ${m.errorRate}% error rate`);
        }
        if (m.latency.p99Ms > 10000) {
          alerts.push(`🐢 ${m.method} p99 latency is ${Math.round(m.latency.p99Ms / 1000)}s`);
        }
      }

      return success({
        service,
        environment: env ?? 'production',
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        totalSamples: spans.length,
        methodCount: methods.length,
        methods: methods.slice(0, 20), // Top 20 methods
        alerts: alerts.length > 0 ? alerts : undefined,
      });
    },
  );

  return tools;
};
