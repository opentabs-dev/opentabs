import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolOrgTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Get current user
  defineTool(
    tools,
    server,
    'retool_get_current_user',
    {
      description: `Get the current authenticated Retool user's profile, org info, group memberships, and feature flags.

Returns: user (id, email, name, groups[]), org (id, companyName, totalSeats, ssoType), experimentValues (feature flag map).
Use this to identify the current user and check which Retool features are enabled.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/user',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: strip massive org themes/CSS/branding, keep essential user + org info
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const user = r.user as Record<string, unknown> | undefined;
        if (user) {
          shaped.user = {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userName: user.userName,
            enabled: user.enabled,
            createdAt: user.createdAt,
            lastActive: user.lastActive,
            lastLoggedIn: user.lastLoggedIn,
            organizationId: user.organizationId,
            twoFactorAuthEnabled: user.twoFactorAuthEnabled,
            userType: user.userType,
            profilePhotoUrl: user.profilePhotoUrl,
            groups: Array.isArray(user.groups)
              ? (user.groups as Record<string, unknown>[]).map(g => ({
                  id: g.id,
                  name: g.name,
                  universalAccess: g.universalAccess,
                }))
              : [],
          };
        }
        const org = r.org as Record<string, unknown> | undefined;
        if (org) {
          shaped.org = {
            id: org.id,
            companyName: org.companyName,
            domain: org.domain,
            subdomain: org.subdomain,
            planId: org.planId,
            billingType: org.billingType,
            totalSeats: org.totalSeats,
            ssoType: org.ssoType,
            releaseManagementEnabled: org.releaseManagementEnabled,
            isGitSyncingEnabled: org.isGitSyncingEnabled,
            createdAt: org.createdAt,
          };
        }
        shaped.experimentValues = r.experimentValues;
      }
      return success(shaped);
    },
  );

  // List permission groups
  defineTool(
    tools,
    server,
    'retool_list_groups',
    {
      description: `List all permission groups in Retool with their access levels.

Returns: groupCount, groups[] with id, name, universalAccess, universalWorkflowAccess, universalResourceAccess, auditLogAccess, etc.
Groups control who can view/edit apps, workflows, resources, and org settings.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/organization/permissions/groups/',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: keep essential group fields
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const groups = r.groups as Record<string, unknown>[] | undefined;
        if (Array.isArray(groups)) {
          shaped.groupCount = groups.length;
          shaped.groups = groups.map(g => ({
            id: g.id,
            name: g.name,
            universalAccess: g.universalAccess,
            universalWorkflowAccess: g.universalWorkflowAccess,
            universalResourceAccess: g.universalResourceAccess,
            universalQueryLibraryAccess: g.universalQueryLibraryAccess,
            universalAgentAccess: g.universalAgentAccess,
            auditLogAccess: g.auditLogAccess,
            userListAccess: g.userListAccess,
            draftAppsAccess: g.draftAppsAccess,
          }));
        }
      }
      return success(shaped);
    },
  );

  // List environments
  defineTool(
    tools,
    server,
    'retool_list_environments',
    {
      description: `List deployment environments configured in Retool (e.g., production, staging).

Returns: environments[] with id, name, description, displayColor, isDefault, createdAt, updatedAt.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/environments',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // List experiments / feature flags
  defineTool(
    tools,
    server,
    'retool_list_experiments',
    {
      description: `List feature flags and experiments for the Retool organization.

Returns: experimentValues map. Note: this endpoint may return an empty map — the full experiment values are also available in retool_get_current_user's experimentValues field.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/experiments',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Search/suggest users
  defineTool(
    tools,
    server,
    'retool_search_users',
    {
      description:
        'Search for users in the Retool organization by email address. Returns matching user suggestions with their IDs, names, and status.',
      inputSchema: {
        query: z.string().describe('Search query (name or email)'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ query, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/organization/bulkSuggestUsers',
        method: 'POST',
        body: { suggestedEmails: [query] },
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
