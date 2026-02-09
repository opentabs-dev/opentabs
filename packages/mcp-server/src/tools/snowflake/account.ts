import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerSnowflakeAccountTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get session/bootstrap info
  define(
    'snowflake_get_session',
    {
      description: `Get the current Snowflake session context.

Returns: user email, organization name, and build version.
May also include: current role/warehouse/database/schema, available roles/warehouses (depends on session state).
Use this to check which identity and role are active before running queries.`,
      inputSchema: {},
    },
    async () => {
      const raw = await sendServiceRequest('snowflake', {
        endpoint: '/bootstrap',
        method: 'GET',
      });

      // The bootstrap response is massive. Extract only the useful session context.
      const data = raw as Record<string, unknown> | undefined;
      if (!data) return success(raw);

      const session: Record<string, unknown> = {};

      // User identity (bootstrap uses PascalCase keys)
      const user = (data.user ?? data.User) as Record<string, unknown> | undefined;
      if (user) {
        session.user = {
          loginName: user.loginName ?? user.LoginName,
          displayName: user.displayName ?? user.DisplayName,
          email: user.email ?? user.Email,
          defaultRole: user.defaultRole ?? user.DefaultRole,
          defaultWarehouse: user.defaultWarehouse ?? user.DefaultWarehouse,
          defaultNamespace: user.defaultNamespace ?? user.DefaultNamespace,
        };
      }

      // Current session context
      const role = data.currentRole ?? data.CurrentRole;
      const warehouse = data.currentWarehouse ?? data.CurrentWarehouse;
      const database = data.currentDatabase ?? data.CurrentDatabase;
      const schema = data.currentSchema ?? data.CurrentSchema;
      if (role) session.currentRole = role;
      if (warehouse) session.currentWarehouse = warehouse;
      if (database) session.currentDatabase = database;
      if (schema) session.currentSchema = schema;

      // Account info
      const account = (data.account ?? data.Account) as Record<string, unknown> | undefined;
      if (account) {
        session.account = {
          name: account.name ?? account.Name ?? account.accountName,
          url: account.url ?? account.Url ?? account.accountUrl,
          region: account.region ?? account.Region,
          edition: account.edition ?? account.Edition,
        };
      }

      // Organization info
      const org = (data.org ?? data.organization ?? data.Org) as Record<string, unknown> | undefined;
      if (org) {
        session.organization = {
          name: org.name ?? org.Name ?? org.orgName,
          displayName: org.displayName ?? org.DisplayName,
          isOrgAdmin: org.isOrgAdmin ?? org.IsOrgAdmin,
        };
      }

      // Build metadata
      if (data.BuildVersion) session.buildVersion = data.BuildVersion;

      // Page context
      const pageParams = (data.PageParams ?? data.pageParams) as Record<string, unknown> | undefined;
      if (pageParams) {
        session.pageParams = {
          account: pageParams.account ?? pageParams.Account,
          organization: pageParams.organization ?? pageParams.Organization,
        };
      }

      // Available roles and warehouses
      if (data.availableRoles) session.availableRoles = data.availableRoles;
      if (data.availableWarehouses) session.availableWarehouses = data.availableWarehouses;

      return success(session);
    },
  );

  // Diagnose Snowflake page internals
  define(
    'snowflake_diagnose',
    {
      description: `Diagnose the Snowflake browser adapter connection.

Returns: whether the nufetch transport is available, the authenticated user email and role,
the API server URL, and the list of available internal API namespaces.
Use this to debug connectivity issues when other Snowflake tools fail.`,
      inputSchema: {},
    },
    async () => {
      const result = await sendServiceRequest('snowflake', {}, 'diagnose');
      return success(result);
    },
  );

  return tools;
};
