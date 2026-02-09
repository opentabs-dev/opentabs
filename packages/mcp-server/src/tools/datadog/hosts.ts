import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogHostsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Get host information
  defineTool(
    tools,
    server,
    'datadog_get_host_info',
    {
      description: `Get detailed information about a specific host.

Returns comprehensive host details including:
- Host metadata (name, aliases, platform)
- AWS/cloud provider info (instance type, availability zone)
- Kubernetes context (node, cluster)
- Agent version and status
- Tags and integrations
- Resource metrics (CPU, memory, disk)

Use this when investigating infrastructure issues or when a trace shows problems on a specific host.
Host names can be found in trace spans (hostname field) or log events.`,
      inputSchema: {
        hostname: z.string().describe('Host name or host ID (e.g., "i-0abc123def456", "my-host.example.com")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ hostname, env }) => {
      // Try to get host by name
      const params: Record<string, string> = {
        filter: `host:${hostname}`,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/hosts',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        host_list?: Array<{
          name?: string;
          id?: number;
          aliases?: string[];
          host_name?: string;
          is_muted?: boolean;
          mute_timeout?: number;
          sources?: string[];
          tags_by_source?: Record<string, string[]>;
          meta?: {
            agent_version?: string;
            platform?: string;
            processor?: string;
            machine?: string;
            gohai?: string;
            install_method?: {
              tool?: string;
              tool_version?: string;
              installer_version?: string;
            };
            cpu_cores?: number;
            socket_fqdn?: string;
            socket_hostname?: string;
          };
          metrics?: {
            cpu?: number;
            iowait?: number;
            load?: number;
          };
          up?: boolean;
          last_reported_time?: number;
          apps?: string[];
          aws_id?: string;
          aws_name?: string;
        }>;
        total_returned?: number;
        total_matching?: number;
      };

      const hosts = response.host_list || [];

      if (hosts.length === 0) {
        return success({
          hostname,
          message: 'Host not found. The host may be offline, not reporting to Datadog, or the name may be incorrect.',
          suggestion: 'Try searching with a partial name or check for the host in infrastructure list.',
        });
      }

      // Return the first matching host
      const host = hosts[0];

      // Extract cloud provider info from tags
      let cloudInfo: {
        provider?: string;
        region?: string;
        availabilityZone?: string;
        instanceType?: string;
        instanceId?: string;
      } | null = null;

      const allTags: string[] = [];
      if (host.tags_by_source) {
        for (const tags of Object.values(host.tags_by_source)) {
          allTags.push(...tags);
        }
      }

      // Parse cloud-related tags
      for (const tag of allTags) {
        if (tag.startsWith('availability-zone:')) {
          cloudInfo = cloudInfo || {};
          cloudInfo.availabilityZone = tag.split(':')[1];
        } else if (tag.startsWith('region:')) {
          cloudInfo = cloudInfo || {};
          cloudInfo.region = tag.split(':')[1];
        } else if (tag.startsWith('instance-type:')) {
          cloudInfo = cloudInfo || {};
          cloudInfo.instanceType = tag.split(':')[1];
        } else if (tag.startsWith('cloud_provider:')) {
          cloudInfo = cloudInfo || {};
          cloudInfo.provider = tag.split(':')[1];
        }
      }

      // Extract Kubernetes info
      let kubernetesInfo: {
        clusterName?: string;
        nodeName?: string;
        namespace?: string;
      } | null = null;

      for (const tag of allTags) {
        if (tag.startsWith('kube_cluster_name:')) {
          kubernetesInfo = kubernetesInfo || {};
          kubernetesInfo.clusterName = tag.split(':')[1];
        } else if (tag.startsWith('kube_node:')) {
          kubernetesInfo = kubernetesInfo || {};
          kubernetesInfo.nodeName = tag.split(':')[1];
        }
      }

      return success({
        name: host.name || host.host_name,
        id: host.id,
        aliases: host.aliases,
        isUp: host.up,
        isMuted: host.is_muted,
        lastReported: host.last_reported_time ? new Date(host.last_reported_time * 1000).toISOString() : undefined,
        agent: {
          version: host.meta?.agent_version,
          platform: host.meta?.platform,
        },
        hardware: {
          processor: host.meta?.processor,
          cpuCores: host.meta?.cpu_cores,
          machine: host.meta?.machine,
        },
        metrics: host.metrics
          ? {
              cpuPercent: host.metrics.cpu,
              iowaitPercent: host.metrics.iowait,
              loadAverage: host.metrics.load,
            }
          : undefined,
        cloud: cloudInfo,
        kubernetes: kubernetesInfo,
        sources: host.sources,
        apps: host.apps,
        tags: allTags.slice(0, 50), // Limit tags to avoid huge output
        datadogUrl: `https://app.datadoghq.com/infrastructure?host=${encodeURIComponent(host.name || hostname)}`,
      });
    },
  );

  // List hosts with filtering
  defineTool(
    tools,
    server,
    'datadog_list_hosts',
    {
      description: `List hosts in the Datadog infrastructure with optional filtering.

Returns hosts matching the filter criteria including:
- Host name and aliases
- Up/down status
- Agent version
- Tags and sources

Useful for:
- Finding hosts in a specific cluster or region
- Identifying hosts running a particular service
- Auditing agent versions across infrastructure`,
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Filter string (e.g., "host:web-*", "availability-zone:us-east-1a", "kube_cluster_name:prod")'),
        sortField: z.enum(['name', 'cpu', 'iowait', 'load']).optional().default('name').describe('Field to sort by'),
        sortDir: z.enum(['asc', 'desc']).optional().default('asc').describe('Sort direction'),
        limit: z.number().optional().default(50).describe('Maximum hosts to return (default: 50)'),
        includeOffline: z.boolean().optional().default(false).describe('Include hosts that are offline'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ filter, sortField, sortDir, limit, includeOffline, env }) => {
      const params: Record<string, string> = {
        count: String(limit ?? 50),
        sort_field: sortField ?? 'name',
        sort_dir: sortDir ?? 'asc',
      };

      if (filter) {
        params.filter = filter;
      }

      if (!includeOffline) {
        params.filter = params.filter ? `${params.filter} AND up:true` : 'up:true';
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/hosts',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        host_list?: Array<{
          name?: string;
          id?: number;
          aliases?: string[];
          is_muted?: boolean;
          sources?: string[];
          up?: boolean;
          last_reported_time?: number;
          meta?: {
            agent_version?: string;
            platform?: string;
          };
          metrics?: {
            cpu?: number;
            iowait?: number;
            load?: number;
          };
        }>;
        total_returned?: number;
        total_matching?: number;
      };

      const hosts = (response.host_list || []).map(host => ({
        name: host.name,
        id: host.id,
        aliases: host.aliases?.slice(0, 3), // Limit aliases
        isUp: host.up,
        isMuted: host.is_muted,
        lastReported: host.last_reported_time ? new Date(host.last_reported_time * 1000).toISOString() : undefined,
        agentVersion: host.meta?.agent_version,
        platform: host.meta?.platform,
        metrics: host.metrics,
        sources: host.sources,
      }));

      return success({
        totalMatching: response.total_matching,
        returned: hosts.length,
        hosts,
      });
    },
  );

  // Get hosts by service - find hosts running a specific service
  defineTool(
    tools,
    server,
    'datadog_get_hosts_by_service',
    {
      description: `Find all hosts running a specific service.

This tool queries infrastructure to find hosts that are running a given service,
which is useful for:
- Finding which hosts to investigate when a service has issues
- Understanding the deployment footprint of a service
- Correlating service issues with specific hosts
- Capacity planning and resource allocation

The search looks for hosts tagged with the service name (e.g., "service:<name>").`,
      inputSchema: {
        service: z.string().describe('Service name to find hosts for (e.g., "billing-lifecycle-dgs")'),
        env: z
          .string()
          .optional()
          .describe('Environment to filter by (e.g., "production", "staging"). If omitted, returns all environments.'),
        limit: z.number().optional().default(50).describe('Maximum hosts to return (default: 50)'),
        includeMetrics: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include CPU/load metrics for each host (default: true)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ service, env, limit, includeMetrics, datadogEnv }) => {
      // Build filter query
      const filterParts = [`service:${service}`];
      if (env) {
        filterParts.push(`env:${env}`);
      }
      const filter = filterParts.join(' AND ');

      const params: Record<string, string> = {
        filter,
        count: String(limit ?? 50),
        sort_field: 'cpu',
        sort_dir: 'desc',
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/hosts',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      const response = result as {
        host_list?: Array<{
          name?: string;
          id?: number;
          aliases?: string[];
          is_muted?: boolean;
          sources?: string[];
          up?: boolean;
          last_reported_time?: number;
          tags_by_source?: Record<string, string[]>;
          meta?: {
            agent_version?: string;
            platform?: string;
          };
          metrics?: {
            cpu?: number;
            iowait?: number;
            load?: number;
          };
        }>;
        total_returned?: number;
        total_matching?: number;
      };

      const hosts = (response.host_list || []).map(host => {
        // Extract environment and other tags
        const allTags: string[] = [];
        if (host.tags_by_source) {
          for (const tags of Object.values(host.tags_by_source)) {
            allTags.push(...tags);
          }
        }

        // Find env tag
        const envTag = allTags.find(t => t.startsWith('env:'));
        const hostEnv = envTag ? envTag.split(':')[1] : undefined;

        // Find cluster tag
        const clusterTag = allTags.find(t => t.startsWith('kube_cluster_name:'));
        const cluster = clusterTag ? clusterTag.split(':')[1] : undefined;

        // Find availability zone
        const azTag = allTags.find(t => t.startsWith('availability-zone:'));
        const availabilityZone = azTag ? azTag.split(':')[1] : undefined;

        const baseInfo: {
          name: string | undefined;
          id: number | undefined;
          isUp: boolean | undefined;
          isMuted: boolean | undefined;
          lastReported: string | undefined;
          env: string | undefined;
          cluster: string | undefined;
          availabilityZone: string | undefined;
          agentVersion: string | undefined;
          platform: string | undefined;
          metrics?: {
            cpuPercent: number | undefined;
            iowaitPercent: number | undefined;
            loadAverage: number | undefined;
          };
          datadogUrl: string;
        } = {
          name: host.name,
          id: host.id,
          isUp: host.up,
          isMuted: host.is_muted,
          lastReported: host.last_reported_time ? new Date(host.last_reported_time * 1000).toISOString() : undefined,
          env: hostEnv,
          cluster,
          availabilityZone,
          agentVersion: host.meta?.agent_version,
          platform: host.meta?.platform,
          datadogUrl: `https://app.datadoghq.com/infrastructure?host=${encodeURIComponent(host.name || '')}`,
        };

        if (includeMetrics !== false && host.metrics) {
          baseInfo.metrics = {
            cpuPercent: host.metrics.cpu,
            iowaitPercent: host.metrics.iowait,
            loadAverage: host.metrics.load,
          };
        }

        return baseInfo;
      });

      // Group by environment for summary
      const envSummary: Record<string, number> = {};
      for (const host of hosts) {
        const e = host.env || 'unknown';
        envSummary[e] = (envSummary[e] || 0) + 1;
      }

      // Calculate health stats
      const upCount = hosts.filter(h => h.isUp).length;
      const highCpuCount = hosts.filter(h => h.metrics && (h.metrics.cpuPercent ?? 0) > 80).length;

      return success({
        service,
        environment: env || 'all',
        totalMatching: response.total_matching,
        returned: hosts.length,
        summary: {
          upCount,
          downCount: hosts.length - upCount,
          highCpuCount,
          byEnvironment: envSummary,
        },
        hosts,
        hint:
          hosts.length === 0
            ? `No hosts found with service:${service}. Check the service name or verify hosts are tagged with the service.`
            : undefined,
      });
    },
  );

  // Mute/unmute host
  defineTool(
    tools,
    server,
    'datadog_mute_host',
    {
      description: `Mute or unmute a host to suppress alerts.

Muting a host prevents alerts from firing for that host during maintenance
or known issues. Use with caution as it can mask real problems.

This is useful for:
- Planned maintenance windows
- Known issues being actively worked on
- Preventing alert fatigue during deployments`,
      inputSchema: {
        hostname: z.string().describe('Host name to mute/unmute'),
        mute: z.boolean().describe('True to mute, false to unmute'),
        message: z.string().optional().describe('Reason for muting (recommended)'),
        endTimestamp: z.number().optional().describe('Unix timestamp when mute should automatically end (optional)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ hostname, mute, message, endTimestamp, env }) => {
      if (mute) {
        const body: Record<string, unknown> = {};
        if (message) body.message = message;
        if (endTimestamp) body.end = endTimestamp;

        const result = await sendServiceRequest('datadog', {
          endpoint: `/api/v1/host/${hostname}/mute`,
          method: 'POST',
          body,
          env: env as ServiceEnv | undefined,
        });
        return success({
          hostname,
          action: 'muted',
          message,
          muteUntil: endTimestamp ? new Date(endTimestamp * 1000).toISOString() : 'indefinitely',
          result,
        });
      } else {
        const result = await sendServiceRequest('datadog', {
          endpoint: `/api/v1/host/${hostname}/unmute`,
          method: 'POST',
          env: env as ServiceEnv | undefined,
        });
        return success({
          hostname,
          action: 'unmuted',
          result,
        });
      }
    },
  );

  return tools;
};
