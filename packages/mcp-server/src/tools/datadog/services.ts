import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogServicesTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List services from service catalog
  defineTool(
    tools,
    server,
    'datadog_list_services',
    {
      description: `List services from the Datadog Service Catalog.

Returns service definitions including:
- Service name and description
- Team ownership
- Contacts (email, slack, etc.)
- Documentation links
- On-call information
- Repository links

Use this to discover services and their owners for debugging or incident response.`,
      inputSchema: {
        query: z.string().optional().describe('Optional search query to filter services by name'),
        limit: z.number().optional().default(50).describe('Maximum number of services to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, limit, env }) => {
      const params: Record<string, string> = {
        'page[size]': String(limit ?? 50),
      };

      if (query) {
        params['filter[query]'] = query;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/services/definitions',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      // Parse and format the response for easier consumption
      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            meta?: {
              'github-html-url'?: string;
              'last-modified-time'?: string;
            };
            schema?: {
              'schema-version'?: string;
              'dd-service'?: string;
              team?: string;
              description?: string;
              application?: string;
              tier?: string;
              lifecycle?: string;
              contacts?: Array<{
                type?: string;
                contact?: string;
                name?: string;
              }>;
              links?: Array<{
                type?: string;
                url?: string;
                name?: string;
              }>;
              tags?: string[];
              integrations?: {
                pagerduty?: { 'service-url'?: string };
                opsgenie?: { 'service-url'?: string; region?: string };
              };
              extensions?: Record<string, unknown>;
            };
          };
        }>;
      };

      const services = (response.data || []).map(svc => {
        const schema = svc.attributes?.schema;
        return {
          id: svc.id,
          name: schema?.['dd-service'],
          team: schema?.team,
          description: schema?.description,
          application: schema?.application,
          tier: schema?.tier,
          lifecycle: schema?.lifecycle,
          contacts: schema?.contacts,
          links: schema?.links,
          tags: schema?.tags,
          integrations: schema?.integrations,
          lastModified: svc.attributes?.meta?.['last-modified-time'],
          githubUrl: svc.attributes?.meta?.['github-html-url'],
        };
      });

      return success({
        count: services.length,
        services,
      });
    },
  );

  // Get detailed service definition
  defineTool(
    tools,
    server,
    'datadog_get_service_definition',
    {
      description: `Get detailed information about a specific service from the Datadog Service Catalog.

Returns comprehensive service information including:
- Service ownership (team, contacts)
- On-call information (PagerDuty, OpsGenie)
- Documentation and runbook links
- Repository information
- Service tier and lifecycle
- Related dashboards and monitors

This is essential for incident response to quickly find who owns a service and how to contact them.`,
      inputSchema: {
        serviceName: z.string().describe('The service name to look up (e.g., "billing-lifecycle-dgs")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ serviceName, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v2/services/definitions/${serviceName}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Parse the response
      const response = result as {
        data?: {
          id?: string;
          type?: string;
          attributes?: {
            meta?: {
              'github-html-url'?: string;
              'last-modified-time'?: string;
              'ingested-schema-version'?: string;
            };
            schema?: {
              'schema-version'?: string;
              'dd-service'?: string;
              team?: string;
              description?: string;
              application?: string;
              tier?: string;
              lifecycle?: string;
              contacts?: Array<{
                type?: string;
                contact?: string;
                name?: string;
              }>;
              links?: Array<{
                type?: string;
                url?: string;
                name?: string;
              }>;
              repos?: Array<{
                name?: string;
                url?: string;
                provider?: string;
              }>;
              docs?: Array<{
                name?: string;
                url?: string;
                provider?: string;
              }>;
              tags?: string[];
              integrations?: {
                pagerduty?: {
                  'service-url'?: string;
                };
                opsgenie?: {
                  'service-url'?: string;
                  region?: string;
                };
              };
              extensions?: Record<string, unknown>;
            };
          };
        };
      };

      const data = response.data;
      const schema = data?.attributes?.schema;
      const meta = data?.attributes?.meta;

      // Format the response for easy consumption
      const serviceInfo = {
        id: data?.id,
        name: schema?.['dd-service'],
        team: schema?.team,
        description: schema?.description,
        application: schema?.application,
        tier: schema?.tier,
        lifecycle: schema?.lifecycle,

        // Contact information - critical for incident response
        contacts: schema?.contacts?.map(c => ({
          type: c.type,
          contact: c.contact,
          name: c.name,
        })),

        // On-call integrations
        onCall: {
          pagerduty: schema?.integrations?.pagerduty?.['service-url'],
          opsgenie: schema?.integrations?.opsgenie
            ? {
                serviceUrl: schema.integrations.opsgenie['service-url'],
                region: schema.integrations.opsgenie.region,
              }
            : undefined,
        },

        // Documentation and links
        links: schema?.links,
        docs: schema?.docs,
        repos: schema?.repos,

        // Metadata
        tags: schema?.tags,
        schemaVersion: schema?.['schema-version'],
        lastModified: meta?.['last-modified-time'],
        githubUrl: meta?.['github-html-url'],

        // Any custom extensions
        extensions: schema?.extensions,
      };

      return success(serviceInfo);
    },
  );

  return tools;
};
