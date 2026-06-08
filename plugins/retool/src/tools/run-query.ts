import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const runQuery = defineTool({
  name: 'run_query',
  displayName: 'Run Query',
  description:
    'Execute a SQL query against a Retool resource and return the results. Use this to test resources, inspect data, or validate queries before wiring them into an app. The resource can be specified by display name or internal UUID.',
  summary: 'Run a SQL query against a resource',
  icon: 'play',
  group: 'Queries',
  input: z.object({
    resource_name: z
      .string()
      .describe('Resource display name (e.g., "Billing Lifecycle (readonly / replica)") or internal UUID'),
    query: z.string().describe('SQL query to execute'),
  }),
  output: z.object({
    data: z.unknown().describe('Query results (column-oriented: { column1: [...values], column2: [...values] })'),
    error: z.string().nullable().describe('Error message if query failed'),
  }),
  handle: async params => {
    const resResp = await api<{ resources: Array<{ name: string; displayName: string; uuid: string }> }>(
      '/api/resources',
    );
    const resource = resResp.resources.find(
      r => r.displayName === params.resource_name || r.name === params.resource_name || r.uuid === params.resource_name,
    );
    if (!resource) throw ToolError.notFound(`Resource "${params.resource_name}" not found`);

    const result = await api<Record<string, unknown>>('/api/playground/query', {
      method: 'POST',
      body: {
        resourceName: resource.name,
        queryType: 'SqlQueryUnified',
        environment: 'production',
        queryName: 'run_query_tool',
        queryId: 0,
        frontendVersion: '1',
        queryTemplate: {
          query: params.query,
          editorMode: 'sql',
          enableTransformer: false,
          transformer: 'return data',
          enableErrorTransformer: false,
          errorTransformer: 'return data.error',
          enableCaching: false,
          queryTimeout: '10000',
          runWhenPageLoads: false,
          requireConfirmation: false,
          queryFailureConditions: '',
          changeset: '',
          changesetIsObject: false,
          changesetObject: '',
          showLatestVersionUpdatedWarning: false,
          timestamp: 0,
          importedQueryDefaults: {},
          importedQueryInputs: {},
          privateParams: [],
          watchedParams: [],
          events: [],
          data: null,
          error: null,
          rawData: null,
          finished: null,
          metadata: null,
          isFetching: false,
          isFunction: false,
          isImported: false,
          runWhenModelUpdates: false,
          queryThrottleTime: '750',
          queryTriggerDelay: '0',
          streamResponse: false,
          allowedGroups: [],
          allowedGroupIds: [],
          offlineQueryType: 'None',
          tableName: '',
          bulkUpdatePrimaryKey: '',
          enableBulkUpdates: false,
          shouldEnableBatchQuerying: false,
          doNotThrowOnNoOp: false,
          databaseNameOverride: '',
          databaseHostOverride: '',
          databaseUsernameOverride: '',
          databasePasswordOverride: '',
          databaseWarehouseOverride: '',
          databaseRoleOverride: '',
          shouldUseLegacySql: false,
          actionType: '',
          records: '',
          recordId: '',
          dataArray: [],
          warningCodes: [],
          filterBy: '',
          cacheKeyTtl: '',
          queryRefreshTime: '',
          successMessage: '',
          queryDisabled: '',
          queryDisabledMessage: '',
          resourceNameOverride: '',
          runWhenPageLoadsDelay: '',
          showSuccessToaster: false,
          showFailureToaster: true,
          notificationDuration: '',
          overrideOrgCacheForUserCache: false,
          showUpdateSetValueDynamicallyToggle: false,
          updateSetValueDynamically: false,
          servedFromCache: false,
          offlineUserQueryInputs: '',
          requestSentTimestamp: null,
          queryRunTime: null,
          queryRunOnSelectorUpdate: false,
          playgroundQueryUuid: '',
          playgroundQueryId: null,
          playgroundQuerySaveId: 'latest',
          workflowId: null,
          workflowParams: null,
          workflowRunBodyType: 'raw',
          workflowRunExecutionType: 'sync',
          _additionalScope: [],
        },
        userParams: {
          queryParams: { length: 0 },
          databaseNameOverrideParams: { length: 0 },
          databaseHostOverrideParams: { length: 0 },
          databaseUsernameOverrideParams: { length: 0 },
          databasePasswordOverrideParams: { length: 0 },
        },
        streamResponse: false,
      },
    });

    if (result && typeof result === 'object' && 'error' in result && result.error) {
      return { data: null, error: String((result as Record<string, unknown>).message ?? result.error) };
    }

    return { data: result, error: null };
  },
});
