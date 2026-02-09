import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// Helper function to get deployments by searching spans for unique versions
const getDeploymentsFromSpans = async (
  service: string,
  queryEnv: string,
  timeRangeHours: number,
  limit: number,
  env?: ServiceEnv,
): Promise<ReturnType<typeof success>> => {
  // Use ISO timestamps
  const now = Date.now();
  const from = now - timeRangeHours * 60 * 60 * 1000;

  // Search for spans from this service to find unique versions
  // Spans API requires data.attributes wrapper
  const requestBody = {
    data: {
      type: 'search_request',
      attributes: {
        filter: {
          query: `service:${service} env:${queryEnv}`,
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        page: {
          limit: 1000, // Get many spans to find unique versions
        },
      },
    },
  };

  const result = await sendServiceRequest('datadog', {
    endpoint: '/api/v2/spans/events/search',
    method: 'POST',
    body: requestBody,
    env,
  });

  interface SpanEvent {
    id?: string;
    attributes?: {
      timestamp?: string;
      service?: string;
      attributes?: {
        version?: string;
        'service.version'?: string;
        git_commit_sha?: string;
        'git.commit.sha'?: string;
        'deployment.environment'?: string;
        pod_name?: string;
        kube_deployment?: string;
      };
      tags?: string[];
    };
  }

  const response = result as {
    data?: SpanEvent[];
  };

  // Extract unique versions with their first/last seen times
  const versionMap = new Map<
    string,
    {
      version: string;
      firstSeen: string;
      lastSeen: string;
      count: number;
      commitSha?: string;
      podNames: Set<string>;
    }
  >();

  for (const span of response.data || []) {
    const attrs = span.attributes?.attributes || {};
    const version = attrs.version || attrs['service.version'];
    const timestamp = span.attributes?.timestamp;

    if (version && timestamp) {
      const existing = versionMap.get(version);
      if (existing) {
        existing.count++;
        if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
        if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
        if (attrs.pod_name) existing.podNames.add(attrs.pod_name);
      } else {
        versionMap.set(version, {
          version,
          firstSeen: timestamp,
          lastSeen: timestamp,
          count: 1,
          commitSha: attrs.git_commit_sha || attrs['git.commit.sha'],
          podNames: attrs.pod_name ? new Set([attrs.pod_name]) : new Set(),
        });
      }
    }
  }

  // Sort by first seen (most recent deployments first)
  const deployments = Array.from(versionMap.values())
    .sort((a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime())
    .slice(0, limit)
    .map((v, index) => ({
      id: `deployment-${index}`,
      service,
      env: queryEnv,
      version: v.version,
      commitSha: v.commitSha,
      firstSeen: v.firstSeen,
      lastSeen: v.lastSeen,
      spanCount: v.count,
      podCount: v.podNames.size,
      status: 'deployed',
    }));

  return success({
    service,
    environment: queryEnv,
    note: 'Deployments derived from APM span versions (DORA API not available)',
    timeRange: {
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
    },
    totalVersions: deployments.length,
    deployments,
  });
};

export const registerDatadogDeploymentsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List deployments (DORA metrics)
  defineTool(
    tools,
    server,
    'datadog_list_deployments',
    {
      description: `List deployments for a service from Datadog's deployment tracking.

Returns deployment events including:
- Deployment timestamp
- Version/commit deployed
- Environment
- Deployment status
- Associated CI/CD info

This is critical for:
- Correlating errors/issues with recent deployments
- Understanding what changed before an incident
- Tracking deployment frequency (DORA metrics)

Note: If DORA metrics are not configured, this tool derives deployments from 
APM span version tags, showing unique versions seen in the time range.`,
      inputSchema: {
        service: z.string().describe('Service name to list deployments for'),
        queryEnv: z.string().optional().default('production').describe('Environment (default: production)'),
        timeRangeHours: z.number().optional().default(168).describe('Time range in hours (default: 168 = 1 week)'),
        limit: z.number().optional().default(20).describe('Maximum deployments to return (default: 20)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    // Go directly to spans-based deployment detection since DORA API isn't available
    async ({ service, queryEnv, timeRangeHours, limit, env }) =>
      getDeploymentsFromSpans(
        service,
        queryEnv ?? 'production',
        timeRangeHours ?? 168,
        limit ?? 20,
        env as ServiceEnv | undefined,
      ),
  );

  // Get deployment by version
  defineTool(
    tools,
    server,
    'datadog_get_deployment',
    {
      description: `Get details about a specific deployment by version or commit.

Useful for:
- Finding when a specific version was deployed
- Getting CI/CD context for a deployment
- Correlating a version with its deployment status`,
      inputSchema: {
        service: z.string().describe('Service name'),
        version: z.string().describe('Version string or commit SHA to look up'),
        queryEnv: z.string().optional().default('production').describe('Environment (default: production)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ service, version, queryEnv, env }) => {
      // Use ISO timestamps
      const now = Date.now();
      const from = now - 30 * 24 * 60 * 60 * 1000; // Last 30 days

      // Search for spans with this version
      // Spans API requires data.attributes wrapper
      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query: `service:${service} env:${queryEnv ?? 'production'} @version:*${version}*`,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: 100,
            },
          },
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/spans/events/search',
        method: 'POST',
        body: requestBody,
        env: env as ServiceEnv | undefined,
      });

      interface SpanEvent {
        id?: string;
        attributes?: {
          timestamp?: string;
          service?: string;
          attributes?: {
            version?: string;
            'service.version'?: string;
            git_commit_sha?: string;
            'git.commit.sha'?: string;
            pod_name?: string;
            kube_deployment?: string;
            'deployment.environment'?: string;
          };
        };
      }

      const response = result as {
        data?: SpanEvent[];
      };

      const spans = response.data || [];
      if (spans.length === 0) {
        return success({
          service,
          version,
          message:
            'No spans found for this version. The version may not have been deployed recently or may not match any deployed versions.',
        });
      }

      // Find version info from spans
      const timestamps = spans.map(s => s.attributes?.timestamp).filter(Boolean) as string[];
      const firstSpan = spans[spans.length - 1];
      const attrs = firstSpan?.attributes?.attributes || {};

      const podNames = new Set<string>();
      for (const span of spans) {
        const podName = span.attributes?.attributes?.pod_name;
        if (podName) podNames.add(podName);
      }

      return success({
        service,
        env: queryEnv ?? 'production',
        version: attrs.version || attrs['service.version'] || version,
        commitSha: attrs.git_commit_sha || attrs['git.commit.sha'],
        firstSeen: timestamps[timestamps.length - 1],
        lastSeen: timestamps[0],
        spanCount: spans.length,
        podCount: podNames.size,
        status: 'deployed',
        investigateUrl: `https://app.datadoghq.com/apm/traces?query=service:${service}%20env:${queryEnv ?? 'production'}%20@version:${encodeURIComponent(version)}`,
      });
    },
  );

  return tools;
};
