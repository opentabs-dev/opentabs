import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const runGrpc = defineTool({
  name: 'run_grpc',
  displayName: 'Run gRPC',
  description:
    'Execute a gRPC method call against a Retool gRPC resource and return the results. Use this to test gRPC resources, call service methods, or validate request/response formats. The resource can be specified by display name or internal UUID.',
  summary: 'Run a gRPC method call',
  icon: 'zap',
  group: 'Queries',
  input: z.object({
    resource_name: z
      .string()
      .describe(
        'Resource display name (e.g., "brex.proto.billing_lifecycle.servicing.v1.services.PaymentPlanService") or internal UUID',
      ),
    method_name: z.string().describe('gRPC method name (e.g., "ListPlanGroups", "SimulatePlan")'),
    body: z.string().describe('JSON request body for the gRPC method'),
    metadata: z.record(z.string(), z.string()).optional().describe('Optional gRPC metadata headers'),
  }),
  output: z.object({
    data: z.unknown().describe('gRPC response data'),
    error: z.string().nullable().describe('Error message if call failed'),
  }),
  handle: async params => {
    const resResp = await api<{ resources: Array<{ name: string; displayName: string; uuid: string }> }>(
      '/api/resources',
    );
    const resource = resResp.resources.find(
      r => r.displayName === params.resource_name || r.name === params.resource_name || r.uuid === params.resource_name,
    );
    if (!resource) throw ToolError.notFound(`Resource "${params.resource_name}" not found`);

    const serviceName = resource.displayName;

    const result = await api<Record<string, unknown>>('/api/playground/query', {
      method: 'POST',
      body: {
        resourceName: resource.name,
        queryType: 'GRPCQuery',
        environment: 'production',
        queryName: 'run_grpc_tool',
        queryId: 0,
        frontendVersion: '1',
        queryTemplate: {
          serviceName,
          methodName: params.method_name,
          query: params.body,
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
          cacheKeyTtl: '',
        },
        userParams: {
          queryParams: { length: 0 },
          metadataParams: { length: 0 },
          methodNameParams: params.method_name,
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
