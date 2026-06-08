import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const addQuery = defineTool({
  name: 'add_query',
  displayName: 'Add Query',
  description:
    'Add a data query to a Retool app. The query connects to an existing resource (database, REST API, gRPC service) and can be referenced by widgets via {{ queryName.data }}. For SQL queries, provide the SQL string. For REST queries, provide httpMethod and query (URL path).',
  summary: 'Add a data query to an app',
  icon: 'terminal',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
    query_id: z.string().describe('Unique query ID (e.g., "getUsers", "listPaymentPlans")'),
    resource_name: z
      .string()
      .describe('Resource display name (e.g., "Billing Lifecycle (readonly / replica)") or internal UUID name'),
    query_type: z
      .enum(['sql', 'RESTQuery', 'grpc'])
      .describe('Query type: sql for databases, RESTQuery for REST APIs, grpc for gRPC services'),
    query_string: z.string().describe('The query: SQL statement, REST URL path, or gRPC method name'),
    run_on_page_load: z.boolean().optional().describe('Whether to run when the page loads (default: false)'),
    additional_properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Extra query template properties (e.g., { httpMethod: "GET", body: "..." } for REST)'),
  }),
  output: z.object({
    save_id: z.number().describe('New save ID'),
    success: z.boolean(),
  }),
  handle: async params => {
    const data = await api<{ page: { id: number; multiplayerSessionId: string | null; data: { appState: string } } }>(
      `/api/pages/uuids/${params.page_uuid}`,
    );
    const currentSaveId = data.page.id;
    const multiplayerSessionId = data.page.multiplayerSessionId;
    const appState = data.page.data.appState;
    if (!appState) throw ToolError.notFound('App state not found');

    const resResp = await api<{ resources: Array<{ name: string; displayName: string; uuid: string }> }>(
      '/api/resources',
    );
    const resource = resResp.resources.find(
      r => r.displayName === params.resource_name || r.name === params.resource_name || r.uuid === params.resource_name,
    );
    const resourceInternalName = resource?.name ?? params.resource_name;

    const parsed = JSON.parse(appState) as unknown[];
    injectQuery(
      parsed,
      params.query_id,
      resourceInternalName,
      params.query_type,
      params.query_string,
      params.run_on_page_load ?? false,
      params.additional_properties ?? {},
    );
    const newAppState = JSON.stringify(parsed);

    const saveResp = await api<{ save: { id: number } }>(`/api/pages/uuids/${params.page_uuid}/save`, {
      method: 'POST',
      body: {
        appState: newAppState,
        branchName: null,
        changesRecordV2: { changes: [], numUntrackedActionsTriggered: 1, isCopilotMode: false },
        saveValidationInfo: { multiplayerSessionId, pageSaveId: currentSaveId },
        isCopilotGenerated: false,
        subflowsDiff: null,
        saveAppTesting: false,
      },
    });

    return { save_id: saveResp.save?.id ?? 0, success: true };
  },
});

function injectQuery(
  parsed: unknown[],
  queryId: string,
  resourceName: string,
  queryType: string,
  queryString: string,
  runOnPageLoad: boolean,
  additionalProps: Record<string, unknown>,
): void {
  const templateMap = parsed[1] as unknown[];
  const vIdx = templateMap.indexOf('v');
  const appMap = templateMap[vIdx + 1] as unknown[];

  let pluginsIdx = -1;
  for (let i = 1; i < appMap.length; i += 2) {
    if (appMap[i] === 'plugins') {
      pluginsIdx = i + 1;
      break;
    }
  }

  if (pluginsIdx === -1) throw ToolError.internal('Could not find plugins map in app state');

  const plugins = appMap[pluginsIdx] as unknown[];
  const entries = plugins[1] as unknown[];
  const now = Date.now();

  const editorType = queryType === 'sql' ? 'sql' : queryType === 'grpc' ? 'grpc' : 'RESTQuery';
  const subtypeMap: Record<string, string> = {
    sql: 'RetoolDatabaseQuery',
    RESTQuery: 'RESTQuery',
    grpc: 'GRPCQuery',
  };

  const templateEntries: unknown[] = [
    'query',
    queryString,
    'runWhenPageLoads',
    runOnPageLoad,
    'enableTransformer',
    false,
    'transformer',
    'return data',
    'requireConfirmation',
    false,
    'queryTimeout',
    '10000',
    'queryFailureConditions',
    '',
    'events',
    ['~#iL', []],
    'enableCaching',
    false,
    'enableErrorTransformer',
    false,
    'notificationDuration',
    '',
    'queryThrottleTime',
    '750',
    'queryTriggerDelay',
    '0',
    'showLatestVersionUpdatedWarning',
    false,
  ];

  for (const [key, val] of Object.entries(additionalProps)) {
    templateEntries.push(key, val);
  }

  const query: unknown[] = [
    '~#iR',
    [
      '^ ',
      'n',
      'pluginTemplate',
      'v',
      [
        '^ ',
        'id',
        queryId,
        'uuid',
        null,
        '_comment',
        null,
        'type',
        'datasource',
        'subtype',
        subtypeMap[queryType] ?? editorType,
        'namespace',
        null,
        'resourceName',
        resourceName,
        'resourceDisplayName',
        null,
        'template',
        ['~#iM', templateEntries],
        'style',
        ['~#iM', []],
        'position2',
        null,
        'mobilePosition2',
        null,
        'mobileAppPosition',
        null,
        'tabIndex',
        null,
        'container',
        '',
        'createdAt',
        `~m${now}`,
        'updatedAt',
        `~m${now}`,
        'folder',
        '',
        'presetName',
        null,
        'screen',
        null,
        'boxId',
        null,
        'subBoxIds',
        null,
      ],
    ],
  ];

  entries.push(queryId, query);
}
